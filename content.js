// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === 'Translated') {
        showPopup('green', 'Translated and copied to clipboard.');
    } else if (request.type === 'SHOW_POPUP') {
        showPopup('red', request.message + ' Meanwhile, visit: ', 'https://otsobear.pyscriptapps.com/latex-to-calc/');
    }
});

// Function to show a custom popup with a fade-out effect
function showPopup(color, message, linkUrl = null) {
    const popup = createPopup(color, message, linkUrl);
    document.body.appendChild(popup);
    fadeOutAndRemove(popup);
}

// Helper function to create a styled popup
function createPopup(color, message, linkUrl) {
    const popup = document.createElement('div');
    const link = linkUrl ? createLink(linkUrl) : null;

    Object.assign(popup.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: color,
        color: 'white',
        padding: '15px',
        borderRadius: '10px',
        fontSize: '16px',
        zIndex: '10000',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
        opacity: '1',
        transition: 'opacity 1s ease'
    });

    popup.innerText = message;
    if (link) {
        popup.appendChild(link);
    }

    return popup;
}

// Helper function to create a clickable link element
function createLink(url) {
    const link = document.createElement('a');
    link.href = url;
    link.innerText = url;
    link.style.color = 'white';
    link.style.textDecoration = 'underline';
    link.target = '_blank';
    link.rel = 'noopener noreferrer'; // Security improvement
    return link;
}

// Function to fade out and remove a popup
function fadeOutAndRemove(popup) {
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => popup.remove(), 1000); // Wait for opacity transition before removing
    }, 4000);
}

// Function to get the selected text or alt text from the hidden image inside the iframe
function getTextFromIframe() {
    if (window.location.hostname === 'kampus.sanomapro.fi') {
        const iframe = document.querySelector('iframe[title="Kaavaeditori"]');
        if (iframe) {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const body = iframeDoc.body;

            if (body && body.classList.contains('rich-text-editor-focus')) {
                const selectedText = getSelectedText(iframeDoc);
                if (selectedText) return selectedText;

                const hiddenImage = iframeDoc.querySelector('div.answer.rich-text-editor.rich-text-focused img[style="display: none;"]');
                if (hiddenImage) return hiddenImage.alt;
            }
        }
    } 
    else {
        const equationEditorDiv = document.querySelector('div[data-testid="equation-editor"]');
        if (equationEditorDiv) {
            const editorValue = equationEditorDiv.getAttribute('data-latex');
            const selectedText = getSelectedText(document);
            const removeWhiteSpace = (str) => str.replace(/\s+/g, '');
            if (selectedText && removeWhiteSpace(editorValue).includes(removeWhiteSpace(selectedText))) {
                return selectedText;
            }
            return editorValue; // Return latexValue
        }
        return getSelectedText(document); // Fallback to normal selection
    }
}

// Function to get selected text
function getSelectedText(doc) {
    const selection = doc.defaultView.getSelection();
    return selection.toString() || '';
}
