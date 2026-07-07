const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createLocalDatabase(filePath) {
    const absolutePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    let store = {};
    if (fs.existsSync(absolutePath)) {
        try {
            store = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) || {};
        } catch (err) {
            console.error(`Failed to read local database at ${absolutePath}:`, err.message);
            store = {};
        }
    }

    const persist = () => {
        const tempPath = `${absolutePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
        fs.renameSync(tempPath, absolutePath);
    };

    const getCollection = (name) => {
        if (!Array.isArray(store[name])) store[name] = [];
        return store[name];
    };

    return {
        collection(name) {
            return createCollection(getCollection(name), persist);
        }
    };
}

function createCollection(documents, persist) {
    return {
        find(filter = {}) {
            let results = documents.filter((doc) => matchesFilter(doc, filter)).map(cloneDocument);
            return {
                sort(sortSpec = {}) {
                    results = sortDocuments(results, sortSpec);
                    return this;
                },
                async toArray() {
                    return results.map(cloneDocument);
                }
            };
        },

        async findOne(filter = {}) {
            const match = documents.find((doc) => matchesFilter(doc, filter));
            return match ? cloneDocument(match) : null;
        },

        async insertOne(document) {
            const entry = cloneDocument(document);
            if (!entry._id) entry._id = createLocalId();
            documents.push(entry);
            persist();
            return { acknowledged: true, insertedId: entry._id };
        },

        async insertMany(entries) {
            const insertedIds = {};
            entries.forEach((document, index) => {
                const entry = cloneDocument(document);
                if (!entry._id) entry._id = createLocalId();
                insertedIds[index] = entry._id;
                documents.push(entry);
            });
            persist();
            return { acknowledged: true, insertedCount: entries.length, insertedIds };
        },

        async updateOne(filter = {}, update = {}, options = {}) {
            const index = documents.findIndex((doc) => matchesFilter(doc, filter));
            if (index !== -1) {
                applyUpdate(documents[index], update, false);
                persist();
                return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedId: null };
            }

            if (options.upsert) {
                const entry = {};
                for (const [key, value] of Object.entries(filter)) {
                    if (!key.startsWith('$') && !isOperatorObject(value)) entry[key] = cloneDocument(value);
                }
                applyUpdate(entry, update, true);
                if (!entry._id) entry._id = createLocalId();
                documents.push(entry);
                persist();
                return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: entry._id };
            }

            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: null };
        },

        async deleteOne(filter = {}) {
            const index = documents.findIndex((doc) => matchesFilter(doc, filter));
            if (index === -1) return { acknowledged: true, deletedCount: 0 };
            documents.splice(index, 1);
            persist();
            return { acknowledged: true, deletedCount: 1 };
        },

        async deleteMany(filter = {}) {
            let deletedCount = 0;
            for (let index = documents.length - 1; index >= 0; index--) {
                if (matchesFilter(documents[index], filter)) {
                    documents.splice(index, 1);
                    deletedCount++;
                }
            }
            if (deletedCount > 0) persist();
            return { acknowledged: true, deletedCount };
        }
    };
}

function cloneDocument(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createLocalId() {
    return crypto.randomBytes(12).toString('hex');
}

function applyUpdate(target, update, isInsert) {
    if (update.$set) {
        for (const [key, value] of Object.entries(update.$set)) setValue(target, key, cloneDocument(value));
    }
    if (isInsert && update.$setOnInsert) {
        for (const [key, value] of Object.entries(update.$setOnInsert)) {
            if (getValue(target, key) === undefined) setValue(target, key, cloneDocument(value));
        }
    }
    if (!update.$set && !update.$setOnInsert) {
        for (const [key, value] of Object.entries(update)) target[key] = cloneDocument(value);
    }
}

function sortDocuments(documents, sortSpec) {
    const entries = Object.entries(sortSpec || {});
    if (entries.length === 0) return documents;

    return [...documents].sort((left, right) => {
        for (const [field, direction] of entries) {
            const a = normalizeForSort(getValue(left, field));
            const b = normalizeForSort(getValue(right, field));
            if (a < b) return direction < 0 ? 1 : -1;
            if (a > b) return direction < 0 ? -1 : 1;
        }
        return 0;
    });
}

function matchesFilter(document, filter = {}) {
    return Object.entries(filter).every(([field, condition]) => {
        const value = getValue(document, field);
        if (isOperatorObject(condition)) return matchesOperators(value, condition);
        return valuesEqual(value, condition);
    });
}

function matchesOperators(value, operators) {
    return Object.entries(operators).every(([operator, expected]) => {
        if (operator === '$in') {
            return Array.isArray(expected) && expected.some((item) => valuesEqual(value, item));
        }

        const left = normalizeComparable(value, expected);
        const right = normalizeComparable(expected, value);

        if (operator === '$gte') return left >= right;
        if (operator === '$gt') return left > right;
        if (operator === '$lte') return left <= right;
        if (operator === '$lt') return left < right;
        return false;
    });
}

function valuesEqual(left, right) {
    return String(normalizeComparable(left, right)) === String(normalizeComparable(right, left));
}

function isOperatorObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((key) => key.startsWith('$'));
}

function getValue(object, dottedPath) {
    return dottedPath.split('.').reduce((current, key) => current?.[key], object);
}

function setValue(object, dottedPath, value) {
    const parts = dottedPath.split('.');
    const last = parts.pop();
    const parent = parts.reduce((current, key) => {
        if (!current[key] || typeof current[key] !== 'object') current[key] = {};
        return current[key];
    }, object);
    parent[last] = value;
}

function normalizeComparable(value, otherValue) {
    if (value && typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
    if (value instanceof Date) return value.getTime();
    if (otherValue instanceof Date || looksLikeDate(value)) {
        const parsed = new Date(value).getTime();
        if (!Number.isNaN(parsed)) return parsed;
    }
    return value;
}

function normalizeForSort(value) {
    if (looksLikeDate(value)) {
        const parsed = new Date(value).getTime();
        if (!Number.isNaN(parsed)) return parsed;
    }
    return value ?? '';
}

function looksLikeDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

module.exports = { createLocalDatabase };
