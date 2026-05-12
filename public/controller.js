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
        return `<button class="token-pill ${ticket.isPriority ? 'prio' : ''}" onclick="selectTicket('${ticket.id}')">${ticket.label}</button>`;
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

socket.on('queue_update', renderControllerState);
socket.on('connect', () => socket.emit('request_queue_update'));
