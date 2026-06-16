const socket = io();
let currentService = '';
let currentPriority = false;
let ticketTimeoutId = null;
let isProcessing = false;

const serviceNames = {
    national: { title: 'National ID', prefix: 'NID' },
    civil: { title: 'Civil Registration', prefix: 'CR' },
};

function openSelection(service) {
    currentService = service;
    document.getElementById('selectionOverlay').style.display = 'flex';
}

function closeAll() {
    if (ticketTimeoutId) {
        clearTimeout(ticketTimeoutId);
        ticketTimeoutId = null;
    }
    document.querySelectorAll('.popup-overlay').forEach(el => el.style.display = 'none');
    currentService = '';
    currentPriority = false;
    isProcessing = false;
    document.querySelectorAll('#selectionOverlay .btn').forEach(b => b.disabled = false);
}

function requestTicket(isPriority) {
    if (!currentService || isProcessing) return;
    isProcessing = true;
    currentPriority = isPriority;

    if (ticketTimeoutId) {
        clearTimeout(ticketTimeoutId);
        ticketTimeoutId = null;
    }

    document.querySelectorAll('#selectionOverlay .btn').forEach(b => b.disabled = true);

    socket.emit('issue_ticket', {
        dept: currentService,
        isPriority: isPriority
    });

    document.getElementById('selectionOverlay').style.display = 'none';
}

function showResult(ticketData) {
    const serviceInfo = serviceNames[ticketData.dept] || serviceNames.other;
    const resultOverlay = document.getElementById('resultOverlay');
    const resultContent = document.getElementById('resultContent');

    resultContent.innerHTML = `
        <div class="text-success mb-3">
            <i class="fas fa-check-circle fa-3x"></i>
        </div>
        <h3 class="font-weight-bold">Ticket Issued!</h3>
        <p class="text-muted mb-0">${serviceInfo.title}</p>
        <p class="badge ${ticketData.isPriority ? 'badge-danger' : 'badge-primary'}">${ticketData.isPriority ? 'Priority Lane' : 'Regular Lane'}</p>
        <div class="ticket-receipt">
            <small class="text-muted d-block mb-1">YOUR QUEUE NUMBER</small>
            <span class="ticket-label-large">${ticketData.label}</span>
        </div>
        <p class="small text-muted mt-3">Please wait for this number to be called.<br>Resetting in 5 seconds...</p>
        <button class="btn btn-outline-primary mt-2" onclick="closeAll()">Done</button>
    `;

    resultOverlay.style.display = 'flex';
    
    if (ticketTimeoutId) {
        clearTimeout(ticketTimeoutId);
    }
    
    ticketTimeoutId = setTimeout(() => {
        closeAll();
    }, 5000);
}

socket.on('ticket_assigned', (data) => {
    showResult(data);
});

socket.on('ticket_error', (err) => {
    const msg = err && err.error ? err.error : (err && err.message) || 'Ticket request failed';
    const resultOverlay = document.getElementById('resultOverlay');
    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = `
        <div class="text-danger mb-3">
            <i class="fas fa-exclamation-triangle fa-3x"></i>
        </div>
        <h3 class="font-weight-bold">Request Failed</h3>
        <p class="text-muted mb-3">${msg}</p>
        <button class="btn btn-outline-primary mt-2" onclick="closeAll()">OK</button>
    `;
    resultOverlay.style.display = 'flex';
    isProcessing = false;
    document.querySelectorAll('#selectionOverlay .btn').forEach(b => b.disabled = false);
});
