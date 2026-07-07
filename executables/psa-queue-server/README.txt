PSA Queuing

Developers:
Jhon Denielle Icawalo
Jhon Marvic Vincent Tudlasan
Paul Timothy Rivera


User Guide & System Documentation

============================================================
OVERVIEW
============================================================

PSA Queuing is a web-based queue management platform designed to streamline customer service operations in Philippine Statistics Authority (PSA) service centers.

The system automates ticket issuance, queue monitoring, customer calling, service window management, and operational reporting through a real-time dashboard powered by Socket.IO and MongoDB.

The primary goals are:
- Reduce customer waiting time
- Improve queue organization
- Prevent ticket duplication
- Provide real-time queue visibility
- Generate operational reports and logs
- Manage multiple service windows simultaneously

============================================================
SYSTEM COMPONENTS
============================================================

1. Ticket Kiosk
2. Queue Display
3. Controller Stations
4. Admin Dashboard
5. Authentication System

============================================================
USER ROLES
============================================================

Administrator
- Manage users
- Monitor queue operations
- View statistics
- Access logs
- Perform daily resets
- Configure service windows

Controller / Service Personnel
- Call next customer
- Recall customer
- Complete service transactions
- Monitor assigned queue

Customers
- Obtain queue tickets
- Monitor queue displays
- Proceed to assigned service windows

============================================================
TICKET GENERATION MODULE
============================================================

Features:
- One-click ticket generation
- Department-based ticket assignment
- Sequential numbering
- Daily ticket reset
- Real-time queue registration

Supported Departments:
- National ID Services
- Civil Registry Services

============================================================
QUEUE DISPLAY MODULE
============================================================

Displays:
- Current serving ticket
- Assigned window number
- Department information
- Queue status

Features:
- Real-time updates
- Automatic refresh
- Multi-window support

============================================================
CONTROLLER MODULE
============================================================

Functions:
- Call Next Ticket
- Recall Ticket
- Complete Service
- Skip Ticket
- Real-Time Updates

============================================================
WINDOW MANAGEMENT
============================================================

Supports multiple service windows with department assignments.

Example:
Window 1 - National ID
Window 2 - National ID
Window 3 - Civil Registry
Window 4 - Civil Registry

============================================================
AUTHENTICATION MODULE
============================================================

Features:
- User Login
- Session Validation
- Role-Based Access Control
- Controller Authentication
- Admin Authentication

============================================================
REAL-TIME COMMUNICATION
============================================================

Powered by Socket.IO.

Updates include:
- Ticket generation
- Queue movement
- Controller actions
- Dashboard statistics

============================================================
DASHBOARD MODULE
============================================================

Provides:
- Live queue monitoring
- Current serving numbers
- Waiting customers
- Completed transactions
- Active controller tracking

============================================================
STATISTICS DASHBOARD
============================================================

Reports:
- Daily Ticket Volume
- Service Counts
- Department Performance
- Queue Activity Trends
- Historical Logs

============================================================
LOGGING SYSTEM
============================================================

Records:
- User Login/Logout
- Ticket Generation
- Queue Calls
- Service Completion
- System Resets
- Controller Activity

============================================================
DAILY RESET PROCESS
============================================================

Performs:
- Queue clearing
- Ticket sequence reset
- Statistics archiving
- Historical record preservation

============================================================
QUEUE WORKFLOW
============================================================

1. Customer arrives.
2. Customer obtains ticket.
3. Ticket enters waiting queue.
4. Customer monitors display.
5. Controller calls ticket.
6. Customer proceeds to service window.
7. Service is completed.
8. Transaction is logged.

============================================================
SYSTEM REQUIREMENTS
============================================================

Server:
- Node.js
- MongoDB
- Express.js
- Socket.IO

Client:
- Google Chrome (Recommended)
- Microsoft Edge
- Mozilla Firefox

============================================================
BENEFITS
============================================================

- Faster service flow
- Organized queue management
- Automated queue handling
- Real-time monitoring
- Operational reporting
- Historical analytics

============================================================
VERSION INFORMATION
============================================================

System Name: PSA Queuing
Version: 2.0
Platform: Web-Based Queue Management System

Local PSA Queuing Mode
----------------------
Use start_psa_queuing_local.bat to run PSA Queuing from the local PC/LAN without MongoDB Atlas.

Default local admin:
Email: admin@psa.local
Password: Admin@12345

Local data is saved to data\psa-queuing-local.json and is ignored by Git.
Technology Stack: Node.js, Express.js, MongoDB, Socket.IO, HTML, CSS, JavaScript

Developed for efficient queue management, real-time customer service monitoring, and operational reporting within PSA service centers.
