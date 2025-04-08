// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === 'Translated') {
        showPopup('green', 'Translated and copied to clipboard.');
    } else if (request.type === 'SHOW_POPUP') {
        showPopup('red', request.message + ' Meanwhile, visit: ', 'https://otsobear.pyscriptapps.com/latex-to-calc/');
        console.warn('Error:', request.message);
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
    link.rel = 'noopener noreferrer';
    return link;
}

// Function to fade out and remove a popup
function fadeOutAndRemove(popup) {
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => popup.remove(), 1000);
    }, 4000);
}

// Function to get selected text
function getSelectedText(doc) {
    const selection = doc?.defaultView?.getSelection();
    return selection ? selection.toString().trim() : '';
}

// Helper to remove whitespace
function removeWhiteSpace(str) {
    return str ? str.replace(/\s+/g, '') : '';
}

// Utility to check LaTeX alt text from document (iframe or not)
function findLatexAlt(doc) {
    // 1. Check Abitti editor container
    const abitti = doc.querySelector('div.abitti-editor-container.rich-text-editor.rich-text-focused');
    const abittiImg = abitti?.querySelector('img');
    if (abittiImg?.alt?.includes('\\')) {
        return { source: 'Abitti editor image', content: abittiImg.alt };
    }

    // 2. Check for active equation image
    const eqImg = doc.querySelector('img.equation.active');
    if (eqImg?.alt?.includes('\\')) {
        return { source: 'active equation image', content: eqImg.alt };
    }

    // 3. Search elements with "focused" class and image children
    const focusedElems = Array.from(doc.querySelectorAll('[class*="focused"]'));
    for (const el of focusedElems) {
        const img = el.querySelector('img');
        if (img?.alt?.includes('\\')) {
            return { source: 'focused element', content: img.alt };
        }
    }

    return null;
}

// Function to get the selected text, clipboard text, or LaTeX alt text from images (iframe or not)
async function getTextFromIframe() {
    try {
        let latexText = '';

        // Check for iframe first
        const iframe = document.querySelector('iframe[title="Kaavaeditori"]');
        if (iframe) {
            console.log('%c LatexToCalc › %cFound equation editor iframe', 'color:#4CAF50;font-weight:bold', '');

            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

            // Check if anything is selected in iframe
            const iframeSelection = getSelectedText(iframeDoc);
            if (iframeSelection) {
                console.log('%c LatexToCalc › %cFound selected text in iframe', 'color:#4CAF50;font-weight:bold', '');
                return iframeSelection;
            } else {
                console.log('%c LatexToCalc › %cNo selection in iframe', 'color:#888;font-weight:bold', 'color:#666');
            }

            // If nothing selected, check for LaTeX in image alt text in iframe
            const result = findLatexAlt(iframeDoc);
            if (result) {
                console.log('%c LatexToCalc › %cFound LaTeX from ' + result.source, 'color:#4CAF50;font-weight:bold', '');
                return result.content;
            } else {
                console.log('%c LatexToCalc › %cNo image alt text in iframe', 'color:#888;font-weight:bold', 'color:#666');
            }
        } else {
            console.log('%c LatexToCalc › %cNo equation editor iframe found', 'color:#888;font-weight:bold', 'color:#666');
        }

        // Check main document if no iframe match
        const mainResult = findLatexAlt(document);
        if (mainResult) {
            console.log('%c LatexToCalc › %cFound LaTeX from ' + mainResult.source, 'color:#4CAF50;font-weight:bold', '');
            return mainResult.content;
        } else {
            console.log('%c LatexToCalc › %cNo image alt text in main document', 'color:#888;font-weight:bold', 'color:#666');
        }

        // Check for specific equation editor div
        const equationEditorDiv = document.querySelector('div[data-testid="equation-editor"]');
        if (equationEditorDiv) {
            console.log('%c LatexToCalc › %cFound equation editor div', 'color:#4CAF50;font-weight:bold', '');

            const editorValue = equationEditorDiv.getAttribute('data-latex');
            const selectedText = getSelectedText(document);

            if (selectedText && removeWhiteSpace(editorValue).includes(removeWhiteSpace(selectedText))) {
                console.log('%c LatexToCalc › %cSelected text matches equation content', 'color:#4CAF50;font-weight:bold', '');
                return selectedText;
            }

            if (editorValue?.trim()) {
                console.log('%c LatexToCalc › %cReturning full data-latex attribute', 'color:#4CAF50;font-weight:bold', '');
                return editorValue;
            }

            console.log('%c LatexToCalc › %cNo useful data-latex attribute found', 'color:#888;font-weight:bold', 'color:#666');
        } else {
            console.log('%c LatexToCalc › %cNo equation editor div found', 'color:#888;font-weight:bold', 'color:#666');
        }

        // Try selected text from main document
        const selectedText = getSelectedText(document);
        if (selectedText) {
            console.log('%c LatexToCalc › %cSelected text found in main document', 'color:#4CAF50;font-weight:bold', '');
            return selectedText;
        } else {
            console.log('%c LatexToCalc › %cNo selected text in main document', 'color:#888;font-weight:bold', 'color:#666');
        }

        // Final fallback: clipboard
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
            console.log('%c LatexToCalc › %cFound text from clipboard', 'color:#4CAF50;font-weight:bold', '');
            return clipboardText;
        } else {
            console.warn('%c LatexToCalc › %cClipboard is empty or inaccessible', 'color:#FF9800;font-weight:bold', '');
            showPopup('red', 'No LaTeX found in iframe, selected text, or clipboard.', 'https://otsobear.pyscriptapps.com/latex-to-calc/');
            return '';
        }
    } catch (error) {
        console.error('%c LatexToCalc › %cError while fetching text:', 'color:#F44336;font-weight:bold', '', error);
        return '';
    }
}
