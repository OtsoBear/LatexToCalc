// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_POPUP') {
        showPopup(request.message);
    }
});

// Function to show a custom red box popup with a fade-out effect and clickable link
function showPopup(message) {
    const popup = document.createElement('div');
    
    // Create an anchor element for the link
    const link = document.createElement('a');
    link.href = 'https://otsobear.pyscriptapps.com/latex-to-calc/';
    link.innerText = 'https://otsobear.pyscriptapps.com/latex-to-calc/';
    link.style.color = 'white';
    link.style.textDecoration = 'underline';
    link.target = '_blank';  // Open the link in a new tab

    // Set initial styles for the popup
    popup.style.position = 'fixed';
    popup.style.bottom = '20px';
    popup.style.right = '20px';
    popup.style.backgroundColor = 'red';
    popup.style.color = 'white';
    popup.style.padding = '15px';
    popup.style.borderRadius = '10px';
    popup.style.fontSize = '16px';
    popup.style.zIndex = '10000';
    popup.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    popup.style.opacity = '1';
    popup.style.transition = 'opacity 1s ease';

    // Add the message text and the clickable link to the popup
    popup.innerText = message + ' Meanwhile, visit: ';
    popup.appendChild(link);

    // Append the popup to the document body
    document.body.appendChild(popup);

    // Start fade-out after 4 seconds
    setTimeout(() => {
        popup.style.opacity = '0';
    }, 4000);

    // Remove popup from DOM after the fade-out completes (5 seconds total)
    setTimeout(() => {
        popup.remove();
    }, 5000);
}
