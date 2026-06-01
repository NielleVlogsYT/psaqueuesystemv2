const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Track locked windows by department + windowKey
const windowLocks = {};

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; 
const uri = "mongodb://deynyelicawalo_db_user:h9sM5NYNeO0R96vw@ac-bbriiqg-shard-00-00.yeogezu.mongodb.net:27017,ac-bbriiqg-shard-00-01.yeogezu.mongodb.net:27017,ac-bbriiqg-shard-00-02.yeogezu.mongodb.net:27017/?ssl=true&replicaSet=atlas-uamnqz-shard-0&authSource=admin&appName=Cluster0";
const client = new MongoClient(uri);

let db;
let adminOTPs = {};
let requeueTimers = {};

// --- 2. GLOBAL QUEUE STATE ---
let ticketSequences = { national: 1, civil: 1 };
let ticketSequenceDate = getTodayString();
let queueStore = {
    waiting: { national: [], civil: [] },
    currentServing: {
        national: { window1: null, window2: null, priorityWindow: null },
        civil: { window1: null, window2: null, priorityWindow: null }
    }
};
const activeUsers = {};

function getTodayString() {
    const now = new Date();
    return now.toISOString().slice(0, 10);
}

function buildDateFilter(dateString) {
    if (!dateString) return null;
    const start = new Date(dateString);
    if (Number.isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { iso_timestamp: { $gte: start, $lt: end } };
}

async function ensureDailyTicketReset() {
    const today = getTodayString();
    if (ticketSequenceDate !== today) {
        await performDailyReset();
        console.log(`🗓️ Daily ticket sequence reset: ${today} -> 001`);
    }
}

async function performDailyReset() {
    try {
        const today = getTodayString();
        console.log(`🕛 Performing nightly reset for ${today}...`);

        const logs = await db.collection('ticket_logs').find({}).toArray();
        if (logs.length > 0) {
            const archivedLogs = logs.map(l => ({ ...l, archivedAt: new Date() }));
            await db.collection('master_history').insertMany(archivedLogs);
            console.log(`✅ Archived ${logs.length} ticket log entries to master_history.`);
        }

        await db.collection('ticket_logs').deleteMany({});
        Object.values(requeueTimers).forEach(clearTimeout);
        requeueTimers = {};

        ticketSequences = { national: 1, civil: 1 };
        ticketSequenceDate = today;
        queueStore.waiting = { national: [], civil: [] };
        queueStore.currentServing = {
            national: { window1: null, window2: null, priorityWindow: null },
            civil: { window1: null, window2: null, priorityWindow: null }
        };

        await saveCurrentState();
        io.emit('queue_update', { currentServing: queueStore.currentServing, waitingQueue: queueStore.waiting });
        io.emit('ticket_logs_updated');
        console.log('🧹 Midnight queue reset complete. Ticket sequence restarted at 001.');
    } catch (err) {
        console.error('Midnight reset failed:', err);
    }
}

function scheduleMidnightReset() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0, 0);
    const delay = nextMidnight.getTime() - now.getTime();
    setTimeout(async () => {
        await performDailyReset();
        scheduleMidnightReset();
    }, delay);
}

// --- 3. PERSISTENCE & LOGGING HELPERS ---
async function logEvent(collectionName, data) {
    if (!db) return;
    try {
        const entry = {
            timestamp_readable: new Date().toLocaleString('en-PH'),
            iso_timestamp: new Date(),
            ...data
        };
        await db.collection(collectionName).insertOne(entry);
    } catch (err) { console.error("Logging failed:", err); }
}

async function saveCurrentState() {
    if (!db) return;
    try {
        await db.collection('system_state').updateOne(
            { id: 'active_queue' },
            { $set: { queueStore, ticketSequences, ticketSequenceDate, lastUpdated: new Date() } },
            { upsert: true }
        );
    } catch (err) { console.error("Save state failed:", err); }
}

function cancelRequeueTimer(ticketLabel) {
    if (!ticketLabel) return;
    if (requeueTimers[ticketLabel]) {
        clearTimeout(requeueTimers[ticketLabel]);
        delete requeueTimers[ticketLabel];
    }
}

async function processExpiredRequeuedTickets() {
    const now = Date.now();
    let changed = false;
    const expiryMs = 600000;

    for (const dept of ['national', 'civil']) {
        const queue = queueStore.waiting[dept];

        for (let i = queue.length - 1; i >= 0; i--) {
            const ticket = queue[i];
            if (ticket?.requeueTime && now - ticket.requeueTime >= expiryMs) {
                queue.splice(i, 1);
                cancelRequeueTimer(ticket.label);
                await logEvent('ticket_logs', { label: ticket.label, department: dept, action: 'AUTO_TERMINATED_AFTER_REQUEUE', reason: '10 minute requeue timeout' });
                changed = true;
                console.log(`[AUTO-TERMINATE] Expired ticket ${ticket.label} removed from ${dept} waiting queue.`);
            }
        }
    }

    if (changed) {
        await saveCurrentState();
        io.emit('queue_update', { currentServing: queueStore.currentServing, waitingQueue: queueStore.waiting });
    }
}

setInterval(processExpiredRequeuedTickets, 30000); 

// --- 4. DATABASE CONNECTION ---
async function connectDB() {
    try {
        await client.connect();
        db = client.db('psa_queue_system');
        const saved = await db.collection('system_state').findOne({ id: 'active_queue' }); 
        if (saved) {
            queueStore = saved.queueStore || queueStore;
            ticketSequences = saved.ticketSequences || { national: 1, civil: 1 };
            ticketSequenceDate = saved.ticketSequenceDate || getTodayString();
            if (ticketSequenceDate !== getTodayString()) {
                await performDailyReset();
                console.log("🗓️ Daily ticket sequence reset after restart");
            }
            console.log("🔄 Persistent State Recovered");
        }
        console.log("✅ Connected to MongoDB Atlas: Archive & History Ready");
        scheduleMidnightReset();
    } catch (e) { console.error("❌ DB Failed:", e.message); process.exit(1); }
}
connectDB();

app.use(express.json());

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// --- SECURE ROUTING FOR STATISTICS DASHBOARD ---
app.get('/stats_Dashboard.html', async (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats_Dashboard.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// --- DEPARTMENT NAME MAPPING ---
const departmentMap = {
    'national': 'National ID',
    'civil': 'Civil Registration'
};

const windowMap = {
    'window1': 'Window 1',
    'window2': 'Window 2',
    'priorityWindow': 'Priority Window',
};

function getDepartmentName(dept) {
    return departmentMap[dept] || dept;
}

function getWindowName(windowKey) {
    return windowMap[windowKey] || windowKey;
}

// --- 5. API ROUTES ---
app.post('/api/get-role', async (req, res) => {
    const user = await db.collection('roles').findOne({ email: req.body.email });
    res.json({ success: true, role: user ? user.role : 'controller' });
});

app.post('/api/set-role', async (req, res) => {
    await db.collection('roles').updateOne({ email: req.body.email }, { $set: { ...req.body, updatedAt: new Date() } }, { upsert: true });
    res.json({ success: true });
});

app.post('/api/request-admin-otp', (req, res) => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    adminOTPs[req.body.email] = otp;
    console.log(`\n🔑 ADMIN OTP for ${req.body.email}: ${otp}\n`);
    res.json({ success: true });
});

app.post('/api/verify-admin-otp', (req, res) => {
    const { email, otp } = req.body;
    if (adminOTPs[email] === otp) { delete adminOTPs[email]; res.json({ success: true }); }
    else { res.json({ success: false, error: "Invalid OTP." }); }
});

app.get('/api/system-logs/:folder', async (req, res) => {
    try {
        let collectionName = req.params.folder;
        const filter = {};
        if (req.query.department) filter.department = req.query.department;
        
        // Check if requesting past date for ticket_logs
        if (collectionName === 'ticket_logs' && req.query.date) {
            const requestedDate = new Date(req.query.date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            requestedDate.setHours(0, 0, 0, 0);
            
            // If requested date is before today, query master_history
            if (requestedDate < today) {
                collectionName = 'master_history';
            }
        }
        
        const dateFilter = buildDateFilter(req.query.date);
        if (dateFilter) Object.assign(filter, dateFilter);
        const logs = await db.collection(collectionName).find(filter).sort({ iso_timestamp: -1 }).toArray();
        res.json({ success: true, logs, collection: collectionName });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/system-logs/roles', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, error: "Database offline" });
        const roles = await db.collection('roles').find({}).toArray();
        res.json({ success: true, roles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/system-logs/:folder/:id', async (req, res) => {
    try {
        await db.collection(req.params.folder).deleteOne({ _id: new ObjectId(req.params.id) });
        io.emit('ticket_logs_updated');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/log-user-logout', async (req, res) => {
    try {
        const { email, userId } = req.body;
        await logEvent('auth_logs', {
            email: email || 'Unknown',
            userId: userId || email || 'Unknown',
            action: 'LOGOUT',
            status: 'logout',
            windows: 'Admin Dashboard'
        });
        io.emit('user_account_logs_updated');
        res.json({ success: true });
    } catch (err) {
        console.error('Logout log failed:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/ticket-statistics', async (req, res) => {
    try {
        if (!db) return res.json({ success: false, error: "Database not connected" });

        const now = new Date();
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const oldestWindow = new Date(now.getTime() - (5 * weekMs));
        const dateFilter = { iso_timestamp: { $gte: oldestWindow } };

        const [ticketLogs, masterLogs] = await Promise.all([
            db.collection('ticket_logs').find({ action: 'ISSUED', ...dateFilter }).toArray(),
            db.collection('master_history').find({ action: 'ISSUED', ...dateFilter }).toArray()
        ]);

        const logs = [...ticketLogs, ...masterLogs];
        const weekData = [];

        for (let i = 5; i >= 0; i--) {
            const weekEnd = new Date(now.getTime() - (i * weekMs));
            const weekStart = new Date(weekEnd.getTime() - weekMs);
            
            weekData.push({
                start: weekStart,
                end: weekEnd,
                label: `${weekStart.toLocaleDateString(undefined, {month:'short', day:'numeric'})} - ${weekEnd.toLocaleDateString(undefined, {month:'short', day:'numeric'})}`,
                national: 0,
                civil: 0
            });
        }

        logs.forEach(log => {
            const timestamp = log.iso_timestamp ? new Date(log.iso_timestamp) : new Date(log.timestamp || log.timestamp_readable || log.archivedAt || Date.now());
            const logTime = timestamp.getTime();
            const bucket = weekData.find(w => logTime >= w.start.getTime() && logTime <= w.end.getTime());
            if (bucket) {
                if (log.department === 'national') bucket.national++;
                else if (log.department === 'civil') bucket.civil++;
            }
        });

        const labels = weekData.map(w => w.label);
        const national = weekData.map(w => w.national);
        const civil = weekData.map(w => w.civil);

        res.json({ success: true, weekLabels: labels, national, civil });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

app.get('/api/daily-transactions', async (req, res) => {
    try {
        if (!db) return res.json({ success: false, error: "Database not connected" });
        const requestedDate = req.query.date || getTodayString();
        const dateFilter = buildDateFilter(requestedDate) || buildDateFilter(getTodayString());
        const filter = { action: 'ISSUED', ...(dateFilter || {}) };
        const logs = await db.collection('ticket_logs').find(filter).toArray();
        
        let total = 0, national = 0, civil = 0;
        logs.forEach(log => {
            total++;
            if (log.department === 'national') national++;
            else if (log.department === 'civil') civil++;
        });
        
        res.json({ success: true, total, national, civil });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/national-id-ticket-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, error: "Database not connected" });
        const requestedDate = req.query.date || getTodayString();
        const dateFilter = buildDateFilter(requestedDate) || buildDateFilter(getTodayString());
        const query = { department: 'national', action: 'ISSUED', ...(dateFilter || {}) };
        const nationalIdTickets = await db.collection('ticket_logs').find(query).toArray();

        let regularCount = 0, priorityCount = 0;
        nationalIdTickets.forEach(ticket => {
            if (ticket.isPriority === true || ticket.isPriority === 'true') priorityCount++;
            else regularCount++;
        });

        res.json({ success: true, regular: regularCount, priority: priorityCount });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/civil-registration-ticket-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, error: "Database not connected" });
        const requestedDate = req.query.date || getTodayString();
        const dateFilter = buildDateFilter(requestedDate) || buildDateFilter(getTodayString());
        const query = { department: 'civil', action: 'ISSUED', ...(dateFilter || {}) };
        const tickets = await db.collection('ticket_logs').find(query).toArray();
        
        let regular = 0, priority = 0;
        tickets.forEach(t => { 
            if (t.isPriority === true || t.isPriority === 'true') priority++; 
            else regular++; 
        });
        res.json({ success: true, regular, priority });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/civil-registration-ticket-status-summary', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, error: "Database not connected" });
        const requestedDate = req.query.date || getTodayString();
        const dateFilter = buildDateFilter(requestedDate) || buildDateFilter(getTodayString());
        const match = { department: 'civil', action: { $in: ['COMPLETED', 'TERMINATED', 'REQUEUED'] }, ...(dateFilter || {}) };
        const summary = await db.collection('ticket_logs').aggregate([
            { $match: match },
            { $group: { _id: "$action", count: { $sum: 1 } } }
        ]).toArray();
        
        let completed = 0, terminated = 0, requeued = 0;
        summary.forEach(item => {
            if (item._id === 'COMPLETED') completed = item.count;
            else if (item._id === 'TERMINATED') terminated = item.count;
            else if (item._id === 'REQUEUED') requeued = item.count;
        });
        res.json({ success: true, completed, terminated, requeued });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/national-id-ticket-status-summary', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, error: "Database not connected" });
        const requestedDate = req.query.date || getTodayString();
        const dateFilter = buildDateFilter(requestedDate) || buildDateFilter(getTodayString());
        const match = { department: 'national', action: { $in: ['COMPLETED', 'TERMINATED', 'REQUEUED'] }, ...(dateFilter || {}) };
        const summary = await db.collection('ticket_logs').aggregate([
            { $match: match },
            { $group: { _id: "$action", count: { $sum: 1 } } }
        ]).toArray();
        
        let completed = 0, terminated = 0, requeued = 0;
        summary.forEach(item => {
            if (item._id === 'COMPLETED') completed = item.count;
            else if (item._id === 'TERMINATED') terminated = item.count;
            else if (item._id === 'REQUEUED') requeued = item.count;
        });
        res.json({ success: true, completed, terminated, requeued });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- 6. SOCKET.IO ---
io.on('connection', (socket) => {

    socket.on('register_active_user', async (data) => {
        activeUsers[socket.id] = { email: data.email, role: data.role, location: data.location, lastSeen: new Date() };
        await logEvent('auth_logs', { email: data.email, action: 'LOGIN', location: data.location });
        broadcastActiveUsers();
    });

    socket.on('register_controller_window', (data) => {
        const { dept, windowKey, email } = data;
        const lockKey = `${dept}_${windowKey}`;

        if (windowLocks[lockKey] && windowLocks[lockKey] !== email) {
            socket.emit('window_lock_error', { message: `The ${getWindowName(windowKey)} in ${getDepartmentName(dept)} is already controlled by another staff.` });
            return;
        } else {
            windowLocks[lockKey] = email;
        }
    });

    const syncState = () => io.emit('queue_update', { currentServing: queueStore.currentServing, waitingQueue: queueStore.waiting });
    
    const performSystemReset = async () => {
        try {
            const logs = await db.collection('ticket_logs').find({}).toArray();
            if (logs.length > 0) {
                const archivedLogs = logs.map(l => ({ ...l, archivedAt: new Date() }));
                await db.collection('master_history').insertMany(archivedLogs);
            }

            await db.collection('ticket_logs').deleteMany({});
            Object.values(requeueTimers).forEach(clearTimeout);
            requeueTimers = {};

            ticketSequences = { national: 1, civil: 1 };
            ticketSequenceDate = getTodayString();
            queueStore.waiting = { national: [], civil: [] };
            queueStore.currentServing = {
                national: { window1: null, window2: null, priorityWindow: null },
                civil: { window1: null, window2: null, priorityWindow: null }
            };

            await saveCurrentState();
            syncState();
            io.emit('ticket_logs_updated');
            socket.emit('reset_queues_success');
            socket.emit('reset_Dailyqueues_success'); 
        } catch (err) { console.error("Reset Failed:", err); }
    };

    // Clean Event Structural Mappings (Duplicates Removed)
    socket.on('reset_system', performSystemReset);
    socket.on('reset_queues', performSystemReset);
    
    socket.on('reset_Dailyqueues', async () => {
        try {
            await performDailyReset();
            socket.emit('reset_Dailyqueues_success');
            io.emit('ticket_logs_updated');
            syncState();
        } catch (err) { console.error("Daily reset failed:", err); }
    });

    socket.on('repeat_voice', (data) => {
        if (!data || !data.ticketNumber) return;
        io.emit('repeat_voice', {
            ticketNumber: data.ticketNumber,
            windowName: data.windowName || 'Designated Window'
        });
    });

    socket.on('request_queue_update', () => {
        socket.emit('queue_update', {
            currentServing: queueStore.currentServing,
            waitingQueue: queueStore.waiting
        });
    });

    socket.on('issue_ticket', async (data) => {
        try {
            const { dept, isPriority } = data || {};
            if (!dept || !['national', 'civil'].includes(dept)) {
                socket.emit('ticket_error', { error: 'Invalid department' });
                return;
            }

            const prefixes = { national: 'NID', civil: 'CR' };
            const prefix = prefixes[dept] || 'TKT';
            const number = String(ticketSequences[dept] || 1).padStart(3, '0');
            const typeChar = isPriority ? 'P' : 'R';
            const label = `${prefix}-${typeChar}-${number}`;
            const typeCharDept = isPriority ? 'Priority' : 'Regular';

            const ticket = {
                id: Date.now().toString() + Math.floor(Math.random() * 1000),
                label,
                department: dept,
                isPriority: !!isPriority,
                customerType: typeCharDept,
                status: 'WAITING',
                issuedTime: new Date(),
                iso_timestamp: new Date(),
                timestamp_readable: new Date().toLocaleString('en-PH')
            };

            queueStore.waiting[dept].push(ticket);
            ticketSequences[dept] = (ticketSequences[dept] || 1) + 1;

            // Fired in parallel to speed up high-frequency load handling
            await Promise.all([
                logEvent('ticket_logs', { ...ticket, action: 'ISSUED' }),
                saveCurrentState()
            ]);

            socket.emit('ticket_assigned', { label: ticket.label, dept: ticket.department, isPriority: ticket.isPriority, customerType: ticket.customerType });
            if (process.env.DEBUG_TICKETS === '1') console.log(`ISSUED ${ticket.label} -> ${dept} priority=${ticket.isPriority}`);
            syncState();
        } catch (err) {
            socket.emit('ticket_error', { error: 'Server error creating ticket' });
        }
    });

    socket.on('assign_ticket', async (data) => {
        const { dept, window, ticketId } = data;
        const index = queueStore.waiting[dept].findIndex(t => t.id === ticketId);
        if (index !== -1 && !queueStore.currentServing[dept][window]) {
            const ticket = queueStore.waiting[dept].splice(index, 1)[0];
            cancelRequeueTimer(ticket.label);
            delete ticket.requeueTime;
            ticket.status = 'SERVING';
            ticket.window = window;
            queueStore.currentServing[dept][window] = ticket;
            
            await logEvent('ticket_logs', { ...ticket, action: 'ASSIGNED', window });
            await saveCurrentState();
            syncState();
        }
    });

    socket.on('complete_ticket', async (data) => {
        const { dept, window } = data;
        const ticket = queueStore.currentServing[dept][window];
        if (ticket) {
            cancelRequeueTimer(ticket.label);

            io.emit('stop_voice', { ticketLabel: ticket.label });

            await logEvent('ticket_logs', { label: ticket.label, department: ticket.department, window, action: 'COMPLETED' });
            queueStore.currentServing[dept][window] = null;
            await saveCurrentState();
            syncState();
        }
    });

    socket.on('terminate_ticket', async (data) => {
        const { dept, window } = data;
        const ticket = queueStore.currentServing[dept][window];
        if (ticket) {
            cancelRequeueTimer(ticket.label);

            io.emit('stop_voice', { ticketLabel: ticket.label });

            await logEvent('ticket_logs', { label: ticket.label, department: ticket.department, window, action: 'TERMINATED' });
            queueStore.currentServing[dept][window] = null;
            await saveCurrentState();
            syncState();
        }
    });

    socket.on('requeue_ticket', async (data) => {
        const { dept, window } = data;
        const ticket = queueStore.currentServing[dept][window];
        if (ticket) {
            if (ticket.requeueCount >= 1) {
                socket.emit('ticket_error', { error: 'Ticket may only be requeued once' });
                return;
            }

            ticket.status = 'WAITING';
            delete ticket.window;
            ticket.requeueTime = Date.now();
            ticket.requeueCount = (ticket.requeueCount || 0) + 1;
            queueStore.waiting[dept].push(ticket);

            io.emit('stop_voice', { ticketLabel: ticket.label });
            
            await logEvent('ticket_logs', { label: ticket.label, department: ticket.department, window, action: 'PENDING_REQUEUE' });
            queueStore.currentServing[dept][window] = null;
            await saveCurrentState();
            syncState();

            const ticketLabel = ticket.label;
            if (requeueTimers[ticketLabel]) clearTimeout(requeueTimers[ticketLabel]);
            requeueTimers[ticketLabel] = setTimeout(async () => {
                const deptQueues = queueStore.waiting[dept];
                const index = deptQueues.findIndex(t => t.label === ticketLabel);
                if (index !== -1) {
                    deptQueues.splice(index, 1);
                    await logEvent('ticket_logs', { label: ticketLabel, department: dept, action: 'AUTO_TERMINATED_AFTER_REQUEUE', reason: '10 minute requeue timeout' });
                    await saveCurrentState();
                    syncState();
                }
                delete requeueTimers[ticketLabel];
            }, 600000); 
        }
    });

    socket.on('manual_requeue_waiting_ticket', async (data) => {
        const { dept, ticketId } = data;
        if (!dept || !['national', 'civil'].includes(dept)) return;

        const queue = queueStore.waiting[dept];
        const index = queue.findIndex(t => t.id === ticketId);
        if (index !== -1) {
            const ticket = queue[index];
            if (ticket.requeueCount >= 1) {
                socket.emit('ticket_error', { error: 'Ticket may only be requeued once' });
                return;
            }

            const requeueTicket = queue.splice(index, 1)[0];
            cancelRequeueTimer(requeueTicket.label);
            requeueTicket.requeueTime = Date.now();
            requeueTicket.requeueCount = (requeueTicket.requeueCount || 0) + 1;
            queue.push(requeueTicket);
            
            await logEvent('ticket_logs', { label: requeueTicket.label, department: dept, action: 'MANUALLY_REQUEUED', reason: 'Staff requeue' });
            await saveCurrentState();
            syncState();
            
            const ticketLabel = requeueTicket.label;
            if (requeueTimers[ticketLabel]) clearTimeout(requeueTimers[ticketLabel]);
            requeueTimers[ticketLabel] = setTimeout(async () => {
                const deptQueues = queueStore.waiting[dept];
                const idx = deptQueues.findIndex(t => t.label === ticketLabel);
                if (idx !== -1) {
                    deptQueues.splice(idx, 1);
                    await logEvent('ticket_logs', { label: ticketLabel, department: dept, action: 'AUTO_TERMINATED_AFTER_REQUEUE', reason: '10 minute requeue timeout' });
                    await saveCurrentState();
                    syncState();
                }
                delete requeueTimers[ticketLabel];
            }, 600000);
        }
    });

    socket.on('acknowledge_requeue_ticket', async (data) => {
        const { dept, ticketId } = data;
        if (!dept || !['national', 'civil'].includes(dept)) return;

        const queue = queueStore.waiting[dept];
        const ticket = queue.find(t => t.id === ticketId);
        if (ticket) {
            await logEvent('ticket_logs', { label: ticket.label, department: dept, action: 'REQUEUED', reason: 'Requeue acknowledged by staff' });
            await saveCurrentState();
            syncState();
        }
    });

    socket.on('manual_terminate_waiting_ticket', async (data) => {
        const { dept, ticketId } = data;
        if (!dept || !['national', 'civil'].includes(dept)) return;

        const queue = queueStore.waiting[dept];
        const index = queue.findIndex(t => t.id === ticketId);
        if (index !== -1) {
            const ticket = queue.splice(index, 1)[0];
            cancelRequeueTimer(ticket.label);
            await logEvent('ticket_logs', { label: ticket.label, department: dept, action: 'TERMINATED', reason: 'Manual termination by staff' });
            await saveCurrentState();
            syncState();
        }
    });

    socket.on('disconnect', () => {
        const userSession = activeUsers[socket.id];
        if (userSession) {
            for (const [lockKey, owner] of Object.entries(windowLocks)) {
                if (owner === userSession.email) {
                    delete windowLocks[lockKey];
                }
            }
        }
        delete activeUsers[socket.id];
        broadcastActiveUsers();
    });

    const broadcastActiveUsers = () => {
        const unique = Array.from(new Map(Object.values(activeUsers).map(u => [u.email, u])).values());
        io.emit('active_users_list', unique);
    };
});

const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    const networkInterfaces = os.networkInterfaces();
    const localIp = Object.values(networkInterfaces)
        .flat()
        .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
        .map((iface) => iface.address)[0] || 'localhost';

    console.log(`🚀 PSA Unified System Online: http://${localIp}:${PORT}/login.html`);
    console.log(`Kiosk: http://${localIp}:${PORT}/getTicketNumberV2.html`);
    console.log(`Public Display: http://${localIp}:${PORT}/queue_Status.html`);
});