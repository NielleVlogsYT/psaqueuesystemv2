import { initControllerSession } from '/controller-auth.js';

document.addEventListener("DOMContentLoaded", () => {
    // 1. Read configurations from the HTML View
    const bodyData = document.body.dataset;
    const DEPT = bodyData.dept;             // e.g., 'civil' or 'national'
    const WINDOW = bodyData.window;         // e.g., 'window1' or 'priorityWindow'
    const IS_PRIORITY = bodyData.priority === 'true'; 
    const PAGE_LOCATION = bodyData.pageLocation;

    // 2. Initialize Session with window locking
    initControllerSession({
        elementId: 'controllerUserInfo',
        pageLocation: PAGE_LOCATION,
        dept: DEPT,
        windowKey: WINDOW
    });

    const socket = io();
    let currentServingTicket = null;
    let allTickets = []; // Track all tickets for timer updates
    const checkedRequeueTickets = new Set(); // Track checked requeue tickets to hide timer/buttons
    const queueItemsContainer = document.getElementById('queue-items');
    const regularQueueContainer = document.getElementById('queue-items-regular');
    const priorityQueueContainer = document.getElementById('queue-items-priority');
    const isCombinedQueue = regularQueueContainer && priorityQueueContainer;
    const REQUEUE_TIMEOUT_MS = 600000; // 10 minutes

    // 3. Socket Event Listeners
    socket.on('queue_update', renderControllerState);
    socket.on('connect', () => {
        socket.emit('request_queue_update');
        // Periodic refresh every 2 seconds as backup
        setInterval(() => socket.emit('request_queue_update'), 2000);
    });

    // Start timer update interval (updates every second)
    setInterval(updateAllTimers, 1000);

    // 4. UI Interaction Listeners
    document.getElementById('btn-complete').addEventListener('click', () => {
        if (!currentServingTicket) return;
        showConfirmModal('complete', () => socket.emit('complete_ticket', { dept: DEPT, window: WINDOW }));
    });

    document.getElementById('btn-terminate').addEventListener('click', () => {
        if (!currentServingTicket) return;
        showConfirmModal('terminate', () => socket.emit('terminate_ticket', { dept: DEPT, window: WINDOW }));
    });

    const repeatBtn = document.getElementById('btn-repeat-voice');
    if (repeatBtn) {
        repeatBtn.addEventListener('click', () => {
            const ticketEl = document.getElementById('current-ticket');
            const ticketNumber = ticketEl ? ticketEl.innerText.trim() : '';

            if (!ticketNumber || ticketNumber === '----' || ticketNumber === '---') {
                return;
            }

            const windowBadge = document.querySelector('.window-badge');
            const windowName = windowBadge ? windowBadge.innerText.trim() : 'Designated Window';

            if ('speechSynthesis' in window) {
                const spokenTicket = ticketNumber.split('').map(char => char === '-' ? 'dash' : char).join(' ');
                const message = `Now calling ticket number ${spokenTicket}, please proceed to ${windowName}.`;

                const utterance = new SpeechSynthesisUtterance(message);
                utterance.rate = 0.95;
                utterance.pitch = 1.0;
                utterance.lang = 'en-US';

                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);
            }

            socket.emit('repeat_voice', { ticketNumber, windowName });
        });
    }

    const requeueButton = document.getElementById('btn-requeue');
    if (requeueButton) {
        requeueButton.addEventListener('click', () => {
            if (!currentServingTicket || currentServingTicket.requeueCount >= 1) return;
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            showConfirmModal('requeue', () => socket.emit('requeue_ticket', { dept: DEPT, window: WINDOW }));
        });
    }

    function updateRequeueButtonState() {
        if (!requeueButton) return;
        const canRequeue = currentServingTicket && (!currentServingTicket.requeueCount || currentServingTicket.requeueCount < 1);
        requeueButton.disabled = !canRequeue;
        requeueButton.title = canRequeue ? '' : 'This ticket has already been requeued once';
    }

    document.getElementById('btn-exit').addEventListener('click', (e) => {
        e.preventDefault();
        showConfirmModal('exit', async () => {
            // Get current user info and log the exit/logout action
            try {
                const userInfoEl = document.getElementById('controllerUserInfo');
                const userEmail = userInfoEl ? userInfoEl.innerText.replace('User: ', '').trim() : 'Unknown';
                
                if (userEmail && userEmail !== 'Loading user...') {
                    await fetch('/api/log-user-logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: userEmail,
                            userId: userEmail
                        })
                    });
                }
            } catch (logErr) {
                console.error('Error logging controller exit:', logErr);
            }
            window.location.href = '/queue-control.html';
        });
    });

    const queueContainers = [queueItemsContainer, regularQueueContainer, priorityQueueContainer].filter(Boolean);
    queueContainers.forEach(container => container.addEventListener('click', (e) => {
        const button = e.target.closest('.assign-btn');
        if (!button || !container.contains(button)) return;

        const ticketId = button.getAttribute('data-ticket-id');
        if (ticketId) {
            if (currentServingTicket) return;
            socket.emit('assign_ticket', { dept: DEPT, window: WINDOW, ticketId });
            return;
        }

        const requeueId = button.getAttribute('data-requeue-id');
        if (requeueId) {
            // Mark this requeue ticket as checked to hide timer and buttons
            checkedRequeueTickets.add(requeueId);
            renderWaitList(allTickets); // Re-render to hide timer/buttons
            // Emit event to mark this ticket as officially requeued (to be counted in stats)
            socket.emit('acknowledge_requeue_ticket', { dept: DEPT, ticketId: requeueId });
            return;
        }

        const terminateId = button.getAttribute('data-terminate-id');
        if (terminateId) {
            socket.emit('manual_terminate_waiting_ticket', { dept: DEPT, ticketId: terminateId });
            return;
        }
    }));

    // 5. Core Logic Functions
    function renderControllerState(state) {
        const deptState = state?.currentServing?.[DEPT] || {};
        currentServingTicket = deptState[WINDOW] || null;
        updateTicketDisplay(currentServingTicket);
        updateRequeueButtonState();
        renderWaitList(state?.waitingQueue?.[DEPT] || []);
    }

    function updateTicketDisplay(ticket) {
        const ticketEl = document.getElementById('current-ticket');
        const displayLabel = ticket?.label || '---';
        ticketEl.innerText = displayLabel;
        ticketEl.classList.toggle('closed', false);
    }

    function renderWaitList(tickets) {
        allTickets = tickets; // Store all tickets for timer updates
        if (isCombinedQueue) {
            renderTicketList(regularQueueContainer, tickets.filter(ticket => !isPriorityTicket(ticket)), false);
            renderTicketList(priorityQueueContainer, tickets.filter(isPriorityTicket), true);
            return;
        }

        const container = queueItemsContainer;
        
        // For priority window, show priority tickets first, then regular tickets as fallback
        if (WINDOW === 'priorityWindow') {
            const priorityTickets = tickets.filter(isPriorityTicket);
            const regularTickets = tickets.filter(ticket => !isPriorityTicket(ticket));
            const allTickets = [...priorityTickets, ...regularTickets];
            renderTicketList(container, allTickets, true);
            return;
        }
        
        const pending = tickets.filter(ticket => isPriorityTicket(ticket) === IS_PRIORITY);
        renderTicketList(container, pending, IS_PRIORITY);
    }

    function formatTimeRemaining(ms) {
        if (ms <= 0) return 'Expired';
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function updateAllTimers() {
        allTickets.forEach(ticket => {
            if (!ticket.requeueTime) return;
            const timerElement = document.getElementById(`timer-${ticket.id}`);
            if (!timerElement) return;
            const elapsed = new Date().getTime() - ticket.requeueTime;
            const remaining = REQUEUE_TIMEOUT_MS - elapsed;
            timerElement.textContent = formatTimeRemaining(remaining);
            // Change color if less than 1 minute remaining
            if (remaining < 60000) {
                timerElement.style.color = 'var(--psa-red, #dc2626)';
            }
        });
    }

    function isPriorityTicket(ticket) {
        if (ticket == null) return false;
        if (ticket.isPriority !== undefined) {
            return Boolean(ticket.isPriority === true || ticket.isPriority === 'true');
        }
        if (ticket.category) {
            return ticket.category.toString().toLowerCase() === 'priority';
        }
        if (ticket.label) {
            return ticket.label.includes('-P-');
        }
        return false;
    }

    function renderTicketList(container, tickets, isPriorityList) {
        if (!container) return;

        if (!tickets.length) {
            container.innerHTML = `
                <div class="empty-queue-msg">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>No pending tickets.<br>New registrations will appear here.</p>
                </div>`;
            return;
        }

        container.innerHTML = tickets.map(ticket => {
            const assignButton = !currentServingTicket
                ? `<button class="assign-btn" data-ticket-id="${ticket.id}">Assign Ticket</button>`
                : '';
            
            // Check if this ticket's requeue has been acknowledged
            const isRequeueChecked = checkedRequeueTickets.has(ticket.id);
            
            const timerText = ticket.requeueTime && !isRequeueChecked
                ? formatTimeRemaining(REQUEUE_TIMEOUT_MS - (new Date().getTime() - ticket.requeueTime))
                : '';
            const timerDisplay = ticket.requeueTime && !isRequeueChecked
                ? `<div class="ticket-timer" id="timer-${ticket.id}">${timerText}</div>`
                : '';
            const ticketType = isPriorityTicket(ticket) ? 'Priority' : 'Regular';
            const displayType = WINDOW === 'priorityWindow' ? ticketType : (isPriorityList ? 'Priority' : 'Regular');
            const ticketCardClass = `ticket-card${isPriorityTicket(ticket) ? ' priority-ticket-card' : ''}`;
            const actionButtons = [];
            if (!currentServingTicket && assignButton) {
                actionButtons.push(assignButton);
            }
            if (ticket.requeueTime && !isRequeueChecked) {
                actionButtons.push(`<button class="assign-btn btn-requeue-check" data-requeue-id="${ticket.id}">✓</button>`);
                actionButtons.push(`<button class="assign-btn btn-requeue-cancel" data-terminate-id="${ticket.id}">✕</button>`);
            }

            return `
                <div class="${ticketCardClass}">
                    <div class="ticket-label">${ticket.label}</div>
                    <div class="ticket-meta">${displayType} queue</div>
                    ${timerDisplay}
                    <div class="assign-actions">${actionButtons.join('')}</div>
                </div>`;
        }).join('');
    }

    // 6. Modal Logic
    function showConfirmModal(type, onConfirm) {
        let overlay = document.getElementById('custom-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'custom-modal';
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal-box">
                    <i id="modal-icon" class="modal-icon"></i>
                    <h2 id="modal-title" class="modal-title">Confirm</h2>
                    <p id="modal-text" class="modal-text">Are you sure?</p>
                    <div class="modal-actions">
                        <button class="modal-btn btn-cancel" id="btn-modal-cancel">Cancel</button>
                        <button id="modal-confirm-btn" class="modal-btn btn-confirm">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            document.getElementById('btn-modal-cancel').addEventListener('click', closeConfirmModal);
        }

        const titleObj = document.getElementById('modal-title');
        const textObj = document.getElementById('modal-text');
        const iconObj = document.getElementById('modal-icon');
        const confirmBtn = document.getElementById('modal-confirm-btn');

        const configs = {
            exit: { title: 'Exit Menu', text: 'Are you sure you want to leave?', icon: 'fas fa-sign-out-alt', color: 'var(--psa-red)' },
            complete: { title: 'Complete Ticket', text: 'Mark currently serving ticket as Completed?', icon: 'fas fa-check-circle', color: 'var(--psa-green)' },
            terminate: { title: 'Terminate Ticket', text: 'Mark this ticket as Terminated?', icon: 'fas fa-times-circle', color: 'var(--psa-red)' },
            requeue: { title: 'Requeue Ticket', text: 'Move the current ticket back to the waiting queue?', icon: 'fas fa-redo-alt', color: 'var(--psa-warning, #f59e0b)' }
        };

        const cfg = configs[type];
        titleObj.innerText = cfg.title;
        textObj.innerText = cfg.text;
        iconObj.className = `${cfg.icon} modal-icon`;
        iconObj.style.color = cfg.color;
        confirmBtn.style.background = cfg.color;

        confirmBtn.onclick = () => {
            closeConfirmModal();
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            onConfirm();
        };

        overlay.classList.add('active');
    }

    function closeConfirmModal() {
        const overlay = document.getElementById('custom-modal');
        if (overlay) overlay.classList.remove('active');
    }
});


