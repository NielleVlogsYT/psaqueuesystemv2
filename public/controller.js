


const socket = io();
const config = window.CONTROLLER_CONFIG || {
    dept: 'national',
    windowKey: 'window1',
    windowTitle: 'Window 1',
    queueType: 'regular'
};

const currentTicketEl = document.getElementById('current-ticket');
const queueItemsEl = document.getElementById('queue-items');
const windowBadgeEl = document.querySelector('.window-badge');
let currentServingTicket = null;

function renderControllerState(state) {
    const deptState = state?.currentServing?.[config.dept] || {};
    currentServingTicket = deptState[config.windowKey] || null;
    currentTicketEl.innerText = currentServingTicket?.label || '----';

    if (windowBadgeEl && config.windowTitle) {
        windowBadgeEl.innerText = config.windowTitle;
    }

    const tickets = (state?.waitingQueue?.[config.dept] || []).map(ticket => ({
        ...ticket,
        isPriority: ticket.isPriority === true || ticket.isPriority === 'true'
    }));
    const filteredTickets = tickets.filter(ticket => {
        return config.queueType === 'priority' ? ticket.isPriority : !ticket.isPriority;
    });

    if (!filteredTickets.length) {
        queueItemsEl.innerHTML = `
            <div class="empty-queue-msg">
                <i class="fas fa-inbox fa-3x mb-3"></i>
                <p>No pending ${config.queueType === 'priority' ? 'priority' : 'regular'} tickets.<br>Select a ticket when one appears.</p>
            </div>
        `;
        return;
    }

    queueItemsEl.innerHTML = filteredTickets.map(ticket => {
        const isRequeued = ticket.requeueTime && !isNaN(ticket.requeueTime);
        if (isRequeued) {
            return `
                <div class="ticket-card">
                    <div class="ticket-label ${ticket.isPriority ? 'prio' : ''}">${ticket.label}</div>
                    <div class="assign-actions">
                        <button class="assign-btn" onclick="selectTicket('${ticket.id}')">Assign</button>
                        <button class="assign-btn" style="background: var(--psa-green);" onclick="manualRequeueTicket('${ticket.id}')">✓</button>
                        <button class="assign-btn" style="background: var(--psa-red);" onclick="manualTerminateTicket('${ticket.id}')">✕</button>
                    </div>
                </div>
            `;
        } else {
            return `<button class="token-pill ${ticket.isPriority ? 'prio' : ''}" onclick="selectTicket('${ticket.id}')">${ticket.label}</button>`;
        }
    }).join('');
}

window.selectTicket = function(ticketId) {
    if (currentServingTicket) return;
    socket.emit('assign_ticket', {
        dept: config.dept,
        window: config.windowKey,
        ticketId
    });
};

window.completeCurrent = function() {
    if (!currentServingTicket) return;
    socket.emit('complete_ticket', {
        dept: config.dept,
        window: config.windowKey
    });
};

window.terminateCurrent = function() {
    if (!currentServingTicket) return;
    socket.emit('terminate_ticket', {
        dept: config.dept,
        window: config.windowKey
    });
};

window.manualRequeueTicket = function(ticketId) {
    // Emit to server to manually requeue this waiting ticket
    socket.emit('manual_requeue_waiting_ticket', {
        dept: config.dept,
        ticketId: ticketId
    });
};

window.manualTerminateTicket = function(ticketId) {
    // Emit to server to manually terminate this waiting ticket
    socket.emit('manual_terminate_waiting_ticket', {
        dept: config.dept,
        ticketId: ticketId
    });
};

socket.on('queue_update', renderControllerState);
socket.on('connect', () => socket.emit('request_queue_update'));

socket.on('connect', () => {

    const userEmailContainer = document.querySelector('#user-info span');
    const systemUserEmail = userEmailContainer ? userEmailContainer.innerText.trim() : "";

    if (config.dept && config.windowKey) {
        socket.emit('register_controller_window', {
            dept: config.dept,
            windowKey: config.windowKey,
            email: systemUserEmail
        });
    }
});

// If another staff member has taken the window, lock down the client dashboard control interfaces
socket.on('window_lock_error', (error) => {
    // Show a warning popup window alert box
    alert(error.message);
    
    // Redirect them back to selection panel area to choose a clear lane assignment
    window.location.href = "/queue-control.html"; 
});

// Optional confirmation flag tracking
socket.on('window_lock_success', (response) => {
    console.log(`%c[Queue System Link]: ${response.message}`, "color: #2ecc71; font-weight: bold;");
});
