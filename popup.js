document.addEventListener('DOMContentLoaded', function () {
    // Default settings (used only if no saved settings exist)
    const defaultSettings = {
        TI_on: true,
        SC_on: false,
        constants_on: true,
        coulomb_on: false,
        e_on: false,
        i_on: false,
        g_on: false
    };

    // Load settings from chrome.storage
    chrome.storage.sync.get("settings", function(data) {
        // Use the saved settings or fallback to defaults if none exist
        const settings = data.settings || defaultSettings;
        console.log("Loaded settings:", settings);
        
        // Initialize checkboxes based on the loaded settings
        document.getElementById("TI_on").checked = settings.TI_on;
        document.getElementById("SC_on").checked = settings.SC_on;
        document.getElementById("constants_on").checked = settings.constants_on;
        document.getElementById("coulomb_on").checked = settings.coulomb_on;
        document.getElementById("e_on").checked = settings.e_on;
        document.getElementById("i_on").checked = settings.i_on;
        document.getElementById("g_on").checked = settings.g_on;
    });

    // Add event listeners to ensure mutual exclusivity between TI and SC
    // and to ensure one of them is always on
    document.getElementById("TI_on").addEventListener('change', function () {
        if (this.checked) {
            document.getElementById("SC_on").checked = false; // Turn off SC if TI is on
        } else {
            // If user tries to turn off TI, turn on SC instead
            document.getElementById("SC_on").checked = true;
            this.checked = false; // Keep TI off
        }
        updateSettings();
    });

    document.getElementById("SC_on").addEventListener('change', function () {
        if (this.checked) {
            document.getElementById("TI_on").checked = false; // Turn off TI if SC is on
        } else {
            // If user tries to turn off SC, turn on TI instead
            document.getElementById("TI_on").checked = true;
            this.checked = false; // Keep SC off
        }
        updateSettings();
    });

    // Listen for changes on other checkboxes
    document.querySelectorAll('input[type="checkbox"]:not(#TI_on):not(#SC_on)').forEach(function (checkbox) {
        checkbox.addEventListener('change', updateSettings);
    });

    // Function to update settings
    function updateSettings() {
        const newSettings = {
            TI_on: document.getElementById("TI_on").checked,
            SC_on: document.getElementById("SC_on").checked,
            constants_on: document.getElementById("constants_on").checked,
            coulomb_on: document.getElementById("coulomb_on").checked,
            e_on: document.getElementById("e_on").checked,
            i_on: document.getElementById("i_on").checked,
            g_on: document.getElementById("g_on").checked
        };

        // Save settings to chrome.storage
        chrome.storage.sync.set({ settings: newSettings }, function() {
            console.log("Settings saved:", newSettings);
        });

        // Send the updated settings to background.js
        chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: newSettings });
    }
});
