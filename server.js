const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rolesFilePath = path.join(__dirname, 'roles.json');
const logDir = path.join(__dirname, 'log');
const logFilePath = path.join(logDir, 'ticket_log.csv');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let roles = {};
try {
    roles = JSON.parse(fs.readFileSync(rolesFilePath, 'utf-8'));
} catch (err) {
    roles = {};
}

const connectedUsers = new Map();
let ticketSequences = { civil: 1, national: 1 };
let queueStore = {
    waiting: { civil: [], national: [] },
    currentServing: {
        civil: { window1: null, window2: null, priorityWindow: null },
        national: { window1: null, window2: null, priorityWindow: null }
    },
    history: []
};

function ensureLogFile() {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, 'date,time,dept,type,ticketNo,action,window\n');
    }
}

function saveRoles() {
    fs.writeFileSync(rolesFilePath, JSON.stringify(roles, null, 2));
}

function buildQueueState() {
    return {
        waitingQueue: queueStore.waiting,
        currentServing: queueStore.currentServing
    };
}

function broadcastQueueState() {
    io.emit('queue_update', buildQueueState());
}

function removeWaitingTicket(dept, ticketId) {
    const queue = queueStore.waiting[dept];
    if (!Array.isArray(queue)) return null;
    const index = queue.findIndex(ticket => ticket.id === ticketId);
    if (index === -1) return null;
    return queue.splice(index, 1)[0];
}

function getTicketLabel(dept, isPriority, ticketNo) {
    const prefix = dept === 'civil' ? 'CR' : 'NID';
    const typeCode = isPriority ? 'P' : 'R';
    return `${prefix}-${typeCode}-${String(ticketNo).padStart(3, '0')}`;
}

function normalizeActiveUser(userValue) {
    if (!userValue) return { email: '', role: 'controller', location: 'Unknown' };
    if (typeof userValue === 'string') {
        return { email: userValue, role: 'controller', location: 'Unknown' };
    }
    return {
        email: userValue.email || '',
        role: userValue.role || 'controller',
        location: userValue.location || 'Unknown'
    };
}

function getActiveUsersSnapshot() {
    return Array.from(connectedUsers.values()).map(normalizeActiveUser);
}

function logTicketEvent(ticket, action, windowKey = '') {
    ensureLogFile();
    const now = new Date();
    const row = [
        now.toISOString().split('T')[0],
        now.toTimeString().split(' ')[0],
        ticket.dept,
        ticket.isPriority ? 'priority' : 'regular',
        ticket.ticketNo,
        action,
        windowKey || ''
    ].join(',') + '\n';
    fs.appendFileSync(logFilePath, row);
}

app.post('/api/get-role', (req, res) => {
    const email = req.body?.email;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });
    const role = roles[email] || 'controller';
    return res.json({ success: true, role });
});

app.post('/api/set-role', (req, res) => {
    const { email, role } = req.body || {};
    if (!email || !role) return res.status(400).json({ success: false, error: 'Email and role are required.' });
    roles[email] = role;
    saveRoles();
    return res.json({ success: true });
});

app.post('/api/ban-user', (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });
    roles[email] = 'banned';
    saveRoles();
    return res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.emit('queue_update', buildQueueState());

    socket.on('register_active_user', (payload) => {
        const { email, role = 'controller', location = 'Unknown' } = (typeof payload === 'string') ? { email: payload } : (payload || {});

        for (const [existingSocketId, existingUser] of connectedUsers.entries()) {
            const existingEmail = normalizeActiveUser(existingUser).email;
            if (existingEmail === email && existingSocketId !== socket.id) {
                io.to(existingSocketId).emit('force_logout_signal', email);
                connectedUsers.delete(existingSocketId);
            }
        }

        connectedUsers.set(socket.id, { email, role, location });
        io.emit('active_users_list', getActiveUsersSnapshot());
    });

    socket.on('update_user_location', (location) => {
        const existingUser = connectedUsers.get(socket.id);
        if (existingUser) {
            existingUser.location = location || existingUser.location || 'Unknown';
            connectedUsers.set(socket.id, existingUser);
            io.emit('active_users_list', getActiveUsersSnapshot());
        }
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.id);
        io.emit('active_users_list', getActiveUsersSnapshot());
    });

    socket.on('kick_user', (email) => {
        for (const [socketId, userValue] of connectedUsers.entries()) {
            const userEmail = normalizeActiveUser(userValue).email;
            if (userEmail === email) {
                io.to(socketId).emit('force_logout_signal', email);
                connectedUsers.delete(socketId);
            }
        }
        io.emit('active_users_list', getActiveUsersSnapshot());
    });

    socket.on('issue_ticket', (data) => {
        const { dept: Service_Unit, isPriority } = data;
        if (!queueStore.waiting[Service_Unit]) return;

        const ticketNo = ticketSequences[Service_Unit]++;
        const label = getTicketLabel(Service_Unit, isPriority, ticketNo);
        const ticket = {
            id: `${Service_Unit}-${Date.now()}-${ticketNo}`,
            ticketNo,
            label,
            dept: Service_Unit,
            isPriority: Boolean(isPriority),
            status: 'waiting',
            window: null,
            createdAt: new Date().toISOString()
        };

        queueStore.waiting[Service_Unit].push(ticket);
        logTicketEvent(ticket, 'created');
        socket.emit('ticket_assigned', ticket);
        io.emit('new_ticket_alert', { dept: Service_Unit, label, isPriority: ticket.isPriority, time: new Date().toLocaleTimeString() });
        broadcastQueueState();
    });

    socket.on('assign_ticket', (data) => {
        const { dept, window, ticketId } = data;
        if (!queueStore.waiting[dept] || !queueStore.currentServing[dept]) return;
        if (queueStore.currentServing[dept][window]) return;

        const ticket = removeWaitingTicket(dept, ticketId);
        if (!ticket) return;

        ticket.status = 'serving';
        ticket.window = window;
        queueStore.currentServing[dept][window] = ticket;
        queueStore.history.push(ticket);
        logTicketEvent(ticket, 'assigned', window);
        broadcastQueueState();
    });

    socket.on('complete_ticket', (data) => {
        const { dept, window } = data;
        if (!queueStore.currentServing[dept] || !queueStore.currentServing[dept][window]) return;

        const ticket = queueStore.currentServing[dept][window];
        ticket.status = 'completed';
        ticket.completedAt = new Date().toISOString();
        queueStore.currentServing[dept][window] = null;
        logTicketEvent(ticket, 'completed', window);
        broadcastQueueState();
    });

    socket.on('terminate_ticket', (data) => {
        const { dept, window } = data;
        if (!queueStore.currentServing[dept] || !queueStore.currentServing[dept][window]) return;

        const ticket = queueStore.currentServing[dept][window];
        ticket.status = 'terminated';
        ticket.terminatedAt = new Date().toISOString();
        queueStore.currentServing[dept][window] = null;
        logTicketEvent(ticket, 'terminated', window);
        broadcastQueueState();
    });

    socket.on('request_queue_update', () => {
        socket.emit('queue_update', buildQueueState());
    });

    socket.on('reset_queues', () => {
        queueStore = {
            waiting: { civil: [], national: [] },
            currentServing: {
                civil: { window1: null, window2: null, priorityWindow: null },
                national: { window1: null, window2: null, priorityWindow: null }
            },
            history: []
        };
        ticketSequences = { civil: 1, national: 1 };
        broadcastQueueState();
        io.emit('clear_all_badges');
    });
});

server.listen(PORT, () => {
    console.log(`\n✅ PSA Queue System: http://localhost:${PORT}/login.html`);
});