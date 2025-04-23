// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === 'Translated') {
        const totalTimeMs = request.totalTime;
        const timeDisplay = totalTimeMs ? ` (${totalTimeMs} ms)` : '';
        showPopup('green', `Translated and copied to clipboard${timeDisplay}.`);
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

// Helper to extract combined content from selection containing text and images
function extractCombinedContent(range) {
    // Get all text content
    const textContent = range.toString().trim();
    
    // Get any image alt text in the selection
    const fragment = range.cloneContents();
    const images = fragment.querySelectorAll('img');
    
    let imageAltTexts = [];
    for (const img of images) {
        if (img.alt && img.alt.includes('\\')) {
            imageAltTexts.push(img.alt);
        }
    }
    
    // If we have both text and image alt content, combine them
    if (textContent && imageAltTexts.length > 0) {
        return { 
            source: 'combined text and image', 
            content: textContent + ' ' + imageAltTexts.join(' ')
        };
    }
    
    // If we only have text content
    if (textContent) {
        return { source: 'text selection', content: textContent };
    }
    
    // If we only have image alt content
    if (imageAltTexts.length > 0) {
        return { source: 'images in selection', content: imageAltTexts.join(' ') };
    }
    
    return null;
}

// Helper to remove whitespace
function removeWhiteSpace(str) {
    return str ? str.replace(/\s+/g, '') : '';
}

/**
 * Collection of specialized LaTeX seekers
 * Each function searches for LaTeX content in a specific way
 */
const LatexFinder = {
    /**
     * Check if selected text is part of an equation
     */
    checkSelectedTextInEquation: function(doc) {
        const selection = doc.getSelection();
        const selectedText = selection?.toString().trim();
        
        if (!selectedText) return null;
        
        // Check if this selection is part of any LaTeX image alt text
        const allImages = Array.from(doc.querySelectorAll('img[alt*="\\"]'));
        for (const img of allImages) {
            if (img.alt && img.alt.includes(selectedText)) {
                return { source: 'partial equation selection', content: selectedText };
            }
        }
        
        return null;
    },
    
    /**
     * Check for focused/active equations
     */
    checkFocusedEquations: function(doc) {
        // Direct equation focus checks
        const focusedEquation = doc.querySelector('img.equation.active, img.equation:focus, img.equation.focused, img:focus.equation, img.selected.equation');
        if (focusedEquation?.alt?.includes('\\')) {
            return { source: 'focused equation', content: focusedEquation.alt };
        }
        
        // General focused image check
        const focusedImg = doc.querySelector('img:focus, img.active, img.focused, img.selected');
        if (focusedImg?.alt?.includes('\\')) {
            return { source: 'focused image', content: focusedImg.alt };
        }
        
        return null;
    },
    
    /**
     * Check for selection containing images with LaTeX
     */
    checkSelectionContent: function(doc) {
        const selection = doc.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        
        const range = selection.getRangeAt(0);
        
        // Combined text and image content
        const combinedContent = extractCombinedContent(range);
        if (combinedContent) {
            return combinedContent;
        }
        
        // Direct selection checks
        const container = range.commonAncestorContainer;
        
        // Direct image selection
        if (container.nodeType === 1 && container.tagName === 'IMG') {
            if (container.alt && container.alt.includes('\\')) {
                return { source: 'selected image', content: container.alt };
            }
        }
        
        // Parent image selection
        const parentElement = container.parentElement;
        if (parentElement && parentElement.tagName === 'IMG') {
            if (parentElement.alt && parentElement.alt.includes('\\')) {
                return { source: 'selected image parent', content: parentElement.alt };
            }
        }
        
        // Images contained within selection
        const selectedImages = range.cloneContents().querySelectorAll('img');
        if (selectedImages && selectedImages.length > 0) {
            for (const img of selectedImages) {
                if (img.alt && img.alt.includes('\\')) {
                    return { source: 'image in selection', content: img.alt };
                }
            }
        }
        
        return null;
    },
    
    /**
     * Check specific rich text editors
     */
    checkRichTextEditors: function(doc) {
        const richTextEditors = doc.querySelectorAll('.rich-text-editor');
        for (const editor of richTextEditors) {
            const focusedImg = editor.querySelector('img:focus, img.selected, img.active, img.focused');
            if (focusedImg?.alt?.includes('\\')) {
                return { source: 'focused rich text editor image', content: focusedImg.alt };
            }
        }
        
        return null;
    },
    
    /**
     * Check for hidden images (often indicates focus in some editors)
     */
    checkHiddenImages: function(doc) {
        const hiddenImages = Array.from(doc.querySelectorAll('img'));
        for (const img of hiddenImages) {
            if (img.style.display === 'none' && img.alt?.includes('\\')) {
                return { source: 'hidden focused image', content: img.alt };
            }
            // Also check computed style in case it's set via CSS
            if (window.getComputedStyle(img).display === 'none' && img.alt?.includes('\\')) {
                return { source: 'hidden focused image (CSS)', content: img.alt };
            }
        }
        
        return null;
    },
    
    /**
     * Check specific editor types like Abitti
     */
    checkSpecificEditors: function(doc) {
        // Abitti editor container
        const abitti = doc.querySelector('div.abitti-editor-container.rich-text-editor.rich-text-focused');
        const abittiImg = abitti?.querySelector('img');
        if (abittiImg?.alt?.includes('\\')) {
            return { source: 'Abitti editor image', content: abittiImg.alt };
        }

        // Active equation image
        const eqImg = doc.querySelector('img.equation.active');
        if (eqImg?.alt?.includes('\\')) {
            return { source: 'active equation image', content: eqImg.alt };
        }
        
        return null;
    },
    
    /**
     * Check elements with "focused" class
     */
    checkFocusedElements: function(doc) {
        const focusedElems = Array.from(doc.querySelectorAll('[class*="focused"]'));
        for (const el of focusedElems) {
            const img = el.querySelector('img');
            if (img?.alt?.includes('\\')) {
                return { source: 'focused element', content: img.alt };
            }
        }
        
        return null;
    },
    
    /**
     * Check for plain text selection
     */
    checkPlainTextSelection: function(doc) {
        const selectedText = getSelectedText(doc);
        if (selectedText) {
            return { source: 'text selection', content: selectedText };
        }
        
        return null;
    }
};

/**
 * Find LaTeX content in the document using various strategies
 */
function findLatexAlt(doc, prioritizeTextSelection = true) {
    let result;
    
    // First check if selected text is part of an equation
    result = LatexFinder.checkSelectedTextInEquation(doc);
    if (result) {
        console.log('%c LatexToCalc › %cFound selected text within equation', 'color:#4CAF50;font-weight:bold', '');
        return result;
    }
    
    // If prioritizing text selection, check for it early
    if (prioritizeTextSelection) {
        result = LatexFinder.checkPlainTextSelection(doc);
        if (result) {
            console.log('%c LatexToCalc › %cFound text selection', 'color:#4CAF50;font-weight:bold', '');
            return result;
        }
    }
    
    // Check focused equations
    result = LatexFinder.checkFocusedEquations(doc);
    if (result) return result;
    
    // Check selection content
    result = LatexFinder.checkSelectionContent(doc);
    if (result) return result;
    
    // Check editor contexts
    result = LatexFinder.checkRichTextEditors(doc);
    if (result) return result;
    
    // Check hidden images (sanomapro style)
    result = LatexFinder.checkHiddenImages(doc);
    if (result) return result;
    
    // Check specific editor types
    result = LatexFinder.checkSpecificEditors(doc);
    if (result) return result;
    
    // Check focused elements
    result = LatexFinder.checkFocusedElements(doc);
    if (result) return result;
    
    // If we're not prioritizing text selection, check it as a last resort
    if (!prioritizeTextSelection) {
        result = LatexFinder.checkPlainTextSelection(doc);
        if (result) {
            console.log('%c LatexToCalc › %cFound text selection (fallback)', 'color:#4CAF50;font-weight:bold', '');
            return result;
        }
    }
    
    return null;
}

/**
 * Main function to get LaTeX content from the page
 */
async function getTextFromIframe() {
    try {
        // ----- Check iframe content -----
        const iframe = document.querySelector('iframe[title="Kaavaeditori"]');
        if (iframe) {
            console.log('%c LatexToCalc › %cFound equation editor iframe', 'color:#4CAF50;font-weight:bold', '');
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

            // In iframes we don't prioritize text selection over equations
            const result = findLatexAlt(iframeDoc, false); 
            if (result) {
                console.log('%c LatexToCalc › %cFound LaTeX from ' + result.source, 'color:#4CAF50;font-weight:bold', '');
                return result.content;
            }
        }

        // ----- Check main document content -----
        const mainResult = findLatexAlt(document, true);
        if (mainResult) {
            console.log('%c LatexToCalc › %cFound LaTeX from ' + mainResult.source, 'color:#4CAF50;font-weight:bold', '');
            return mainResult.content;
        }

        // ----- Check special equation editor elements -----
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
        }

        // ----- Try clipboard as last resort -----
        try {
            const clipboardText = await navigator.clipboard.readText();
            if (clipboardText) {
                console.log('%c LatexToCalc › %cFound text from clipboard', 'color:#4CAF50;font-weight:bold', '');
                return clipboardText;
            }
        } catch (clipError) {
            console.warn('%c LatexToCalc › %cClipboard access denied', 'color:#FF9800;font-weight:bold', '');
        }
        
        // Nothing found
        showPopup('red', 'No LaTeX found in iframe, selected text, or clipboard.', 'https://otsobear.pyscriptapps.com/latex-to-calc/');
        return '';
    } catch (error) {
        console.error('%c LatexToCalc › %cError while fetching text:', 'color:#F44336;font-weight:bold', '', error);
        return '';
    }
}
