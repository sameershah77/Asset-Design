// API Base URL
const API_BASE_URL = 'https://localhost:7186'; // Update this to match your backend URL

// Hub endpoints (adjust to your backend routes)
const NOTIFICATIONS_HUB_PATH = '/hubs/notifications';
// Build a SignalR connection helper
function buildConnection(hubPath) {
    return new signalR.HubConnectionBuilder()
        .withUrl(`${API_BASE_URL}${hubPath}`, {
            withCredentials: true, // Important for sending cookies
            skipNegotiation: false,
            transport: signalR.HttpTransportType.WebSockets
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000]) // Retry intervals
        .configureLogging(signalR.LogLevel.Information) // Add logging for debugging
        .build();
}

// Create SignalR connections
const notificationConnection = buildConnection(NOTIFICATIONS_HUB_PATH);

// Notification manager
class NotificationManager {
    static show(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to document
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
}

// SignalR event handlers - Notifications hub
notificationConnection.on("DeviceAdded", (asset) => {
    console.log("DeviceAdded event received:", asset);
    NotificationManager.show(`New asset "${asset.name}" has been added`, 'success');
});

notificationConnection.on("DeviceUpdated", (asset) => {
    console.log("DeviceUpdated event received:", asset);
    NotificationManager.show(`Asset "${asset.name}" has been updated`, 'info');
});

notificationConnection.on("DeviceRemoved", (id) => {
    console.log("DeviceRemoved event received:", id);
    NotificationManager.show(`Asset with ID ${id} has been removed`, 'warning');
});

// Add connection state change logging
notificationConnection.onreconnecting(error => {
    console.log("SignalR Reconnecting:", error);
    NotificationManager.show("Reconnecting to server...", 'warning');
});

notificationConnection.onreconnected(connectionId => {
    console.log("SignalR Reconnected:", connectionId);
    NotificationManager.show("Reconnected successfully!", 'success');
});

notificationConnection.onclose(error => {
    console.log("SignalR Connection closed:", error);
    NotificationManager.show("Connection closed", 'error');
});

// Metrics/averages hub handlers
notificationConnection.on("ReceiveAverage", (columnName, average) => {
    console.log("ReceiveAverage:", { columnName, average });
    // Show a concise toast; customize as needed
    NotificationManager.show(`Average ${columnName}: ${average}`, 'info');
    // Optionally: update specific UI elements if they exist
    // Example: if columnName maps to an element id
    const el = document.getElementById(`avg-${String(columnName).toLowerCase()}`);
    if (el) el.textContent = average;
});



// Start a specific connection with retries
async function startConnection(conn, label) {
    try {
        await conn.start();
        console.log(`${label} SignalR connected successfully`);
        // Only show a toast for the notifications hub to reduce noise
        if (label === 'Notifications') {
            NotificationManager.show("Connected to real-time notifications", 'success');
        }
    } catch (err) {
        console.error(`${label} SignalR Connection Error:`, err);
        if (label === 'Notifications') {
            NotificationManager.show(`Connection Error (${label}): ${err.message}`, 'error');
        }
        
        // Log detailed error information
        if (err.innerError) {
            console.error("Inner Error:", err.innerError);
        }
        
        // Retry connection after 5 seconds
        console.log("Retrying connection in 5 seconds...");
        setTimeout(() => startConnection(conn, label), 5000);
    }
}

// Handle connection closed (notifications)
notificationConnection.onclose(async () => {
    NotificationManager.show("Connection lost. Reconnecting...", 'warning');
    await startConnection(notificationConnection, 'Notifications');
});

// Handle connection closed (metrics)
notificationConnection.onclose(async () => {
    console.warn("Metrics hub connection closed. Attempting to reconnect...");
    await startConnection(metricsConnection, 'Metrics');
});

// Start the connection when the document is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Start both hubs in parallel
    await Promise.all([
        startConnection(notificationConnection, 'Notifications'),
        startConnection(metricsConnection, 'Metrics')
    ]);
});