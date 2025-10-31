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
        // Ensure text is visible regardless of global CSS
        notification.style.color = '#fff';
        
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

// Throttle map to avoid spamming the user with the same connection error repeatedly
const _lastNotificationAt = {};
const _notificationThrottleMs = 20000; // 20 seconds

function _shouldShowNotification(key) {
    try {
        const now = Date.now();
        const last = _lastNotificationAt[key] || 0;
        if (now - last >= _notificationThrottleMs) {
            _lastNotificationAt[key] = now;
            return true;
        }
        return false;
    } catch (e) {
        return true;
    }
}

// SignalR event handlers - Notifications hub
notificationConnection.on("DeviceAdded", (asset) => {
    console.log("DeviceAdded event received:", asset);
    const extractName = (a) => {
        if (!a) return null;
        if (typeof a === 'string' || typeof a === 'number') return String(a);
        if (a.name) return a.name;
        if (a.Name) return a.Name;
        if (a.assetName) return a.assetName;
        if (a.AssetName) return a.AssetName;
        if (a.Id) return String(a.Id);
        if (a.AssetId) return String(a.AssetId);
        if (a.asset && (a.asset.name || a.asset.Name)) return a.asset.name || a.asset.Name;
        return null;
    };
    const n = extractName(asset);
    NotificationManager.show(n ? `New asset "${n}" has been added` : 'A new asset has been added', 'success');
});

notificationConnection.on("DeviceUpdated", (asset) => {
    console.log("DeviceUpdated event received:", asset);
    // Accept multiple payload shapes from the server. If name is missing, fall back to a generic message.
    const extractName = (a) => {
        if (!a) return null;
        if (typeof a === 'string' || typeof a === 'number') return String(a);
        if (a.name) return a.name;
        if (a.Name) return a.Name;
        if (a.assetName) return a.assetName;
        if (a.AssetName) return a.AssetName;
        if (a.Id) return String(a.Id);
        if (a.AssetId) return String(a.AssetId);
        if (a.asset && (a.asset.name || a.asset.Name)) return a.asset.name || a.asset.Name;
        return null;
    };
    const name = extractName(asset);
    NotificationManager.show(name ? `Asset "${name}" has been updated` : 'An asset has been updated', 'info');
});

notificationConnection.on("DeviceRemoved", (id) => {
    console.log("DeviceRemoved event received:", id);
    NotificationManager.show(`Asset with ID ${id} has been removed`, 'warning');
});

// Add connection state change logging
notificationConnection.onreconnecting(error => {
    console.log("SignalR Reconnecting:", error);
    const key = `conn:Notifications:reconnecting`;
    if (_shouldShowNotification(key)) {
        NotificationManager.show("Reconnecting to server...", 'warning');
    }
});

notificationConnection.onreconnected(connectionId => {
    console.log("SignalR Reconnected:", connectionId);
    // Clear any throttles for this connection so future errors will surface immediately
    _lastNotificationAt[`conn:Notifications:error`] = 0;
    NotificationManager.show("Reconnected successfully!", 'success');
});

// Consolidated onclose handler: throttle notification and attempt reconnects for Notifications and Metrics
notificationConnection.onclose(async (error) => {
    console.log("SignalR Connection closed:", error);
    const key = `conn:Notifications:closed`;
    if (_shouldShowNotification(key)) {
        NotificationManager.show("Connection lost. Reconnecting...", 'warning');
    }
    // Try to restart notifications connection (throttling inside startConnection will suppress repeated error toasts)
    try { await startConnection(notificationConnection, 'Notifications'); } catch(_) {}
    // If a metrics connection exists, attempt to restart it as well
    if (typeof metricsConnection !== 'undefined' && metricsConnection) {
        try { await startConnection(metricsConnection, 'Metrics'); } catch(_) {}
    }
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
            const key = `conn:${label}:error`;
            if (_shouldShowNotification(key)) {
                NotificationManager.show(`Connection Error (${label}): ${err.message}`, 'error');
            } else {
                console.debug('Suppressed repeated connection error notification for', label);
            }
        }
        
        // Log detailed error information
        if (err.innerError) {
            console.error("Inner Error:", err.innerError);
        }
        
        // Retry connection after configured throttle interval (20s)
        console.log(`Retrying connection in ${_notificationThrottleMs / 1000} seconds...`);
        setTimeout(() => startConnection(conn, label), _notificationThrottleMs);
    }
}

// (onclose consolidated above)

// Start the connection when the document is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Start both hubs in parallel
    await Promise.all([
        startConnection(notificationConnection, 'Notifications'),
        startConnection(metricsConnection, 'Metrics')
    ]);
});