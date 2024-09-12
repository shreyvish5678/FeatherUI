const chatMessages = document.getElementById('chat-messages');
const userMessage = document.getElementById('user-message');
const sendButton = document.getElementById('send-button');
const modelSelect = document.getElementById('model-select');
const chatTitle = document.getElementById('chat-title');
const imageUpload = document.getElementById('image-upload');
const uploadButton = document.getElementById('upload-button');
const imagePreview = document.createElement('img');

let messageHistory = [];
let isGenerating = false;
let currentModel = 'llama3.1';
let isFirstLoad = true;
let currentUploadedImage = null;

marked.setOptions({
    highlight: function(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

function getModelName(modelId) {
    const modelNames = {
        'llama3.1': 'Llama 3.1',
        'llama2-uncensored': 'Llama 2 Uncensored',
        'deepseek-coder-v2:lite': 'Deepseek Coder'
    };
    return modelNames[modelId] || modelId;
}

async function fetchMiniCPMVResponse(model, prompt, base64Images) {
    const url = "http://localhost:11434/api/generate"; // Your API endpoint
    const headers = {
        "Content-Type": "application/json"
    };

    const data = {
        model: model, 
        prompt: prompt,
        stream: false,
        images: base64Images 
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(data) 
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const jsonResponse = await response.json(); 
        return jsonResponse; 

    } catch (error) {
        console.error("Error in fetchMiniCPMVResponse:", error);
        throw error; // Propagate the error to handle it elsewhere
    }
}


async function fetchLlamaResponse(messages) {
    const url = "http://localhost:11434/api/chat";
    const headers = {"Content-Type": "application/json"};
    const data = {
        "model": currentModel,
        "messages": messages
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        let partialResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.trim() !== '') {
                    try {
                        const parsedLine = JSON.parse(line);
                        if (parsedLine.message && parsedLine.message.content) {
                            partialResponse += parsedLine.message.content;
                            updateAssistantMessage(partialResponse);
                        }
                    } catch (error) {
                        console.error('Error parsing JSON:', error);
                    }
                }
            }
        }

        return partialResponse;
    } catch (error) {
        console.error("Error in fetchLlamaResponse:", error);
        return "Error generating response";
    }
}

function updateAssistantMessage(content) {
    let assistantMessageElement = chatMessages.querySelector('.message.assistant:last-child');
    if (!assistantMessageElement) {
        assistantMessageElement = document.createElement('div');
        assistantMessageElement.className = 'message assistant';
        const nameElement = document.createElement('div');
        nameElement.className = 'message-name';
        nameElement.textContent = getModelName(currentModel);
        assistantMessageElement.appendChild(nameElement);
        const contentElement = document.createElement('div');
        assistantMessageElement.appendChild(contentElement);
        chatMessages.appendChild(assistantMessageElement);
    }
    assistantMessageElement.lastChild.innerHTML = renderContent(content);
    hljs.highlightAll();
}

async function handleSendMessage() {
    const message = userMessage.value.trim();
    if (message && !isGenerating) {
        isGenerating = true;
        showLoadingScreen();

        let fullPrompt = message;
        if (currentUploadedImage) {
            const miniCPMVResponse = await fetchMiniCPMVResponse("minicpm-v", message, currentUploadedImage);
            fullPrompt = `User uploaded an image with prompt: "${message}", answer the prompt with this info "${miniCPMVResponse}"`;
        }

        addMessage('user', message, currentUploadedImage);
        userMessage.value = '';
        currentUploadedImage = null;
        imagePreview.src = '';
        imagePreview.style.display = 'none';

        const llamaResponse = await fetchLlamaResponse([...messageHistory, { role: 'user', content: fullPrompt }]);
        addMessage('assistant', llamaResponse);

        isGenerating = false;
        hideLoadingScreen();
    }
}

sendButton.addEventListener('click', handleSendMessage);

userMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isGenerating) {
        handleSendMessage();
    }
});

uploadButton.addEventListener('click', () => {
    imageUpload.click();
});

imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            currentUploadedImage = event.target.result.split(',')[1];
            imagePreview.src = event.target.result;
            imagePreview.alt = 'Uploaded image';
            imagePreview.style.maxWidth = '200px';
            imagePreview.style.maxHeight = '200px';
            imagePreview.style.display = 'block';
            imagePreview.style.marginTop = '10px';
            
            const userInputContainer = document.querySelector('.user-input');
            userInputContainer.insertBefore(imagePreview, sendButton);
        };
        reader.readAsDataURL(file);
    }
});

modelSelect.addEventListener('change', (e) => {
    currentModel = e.target.value;
    chatTitle.textContent = `Shrey's Chat with ${getModelName(currentModel)}`;
    messageHistory = [];
    updateChatMessages();
    isFirstLoad = true;
});

// Other existing functions like addMessage, updateChatMessages, renderContent, etc.

function addMessage(role, content, image = null) {
    messageHistory.push({ role, content, image });
    if (messageHistory.length > 10) {
        messageHistory.shift();
    }
    updateChatMessages();
}

function updateChatMessages() {
    chatMessages.innerHTML = '';
    messageHistory.forEach(message => {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}`;
        const nameElement = document.createElement('div');
        nameElement.className = 'message-name';
        nameElement.textContent = message.role === 'user' ? 'Shrey' : getModelName(currentModel);
        messageElement.appendChild(nameElement);
        const contentElement = document.createElement('div');
        contentElement.innerHTML = renderContent(message.content);
        messageElement.appendChild(contentElement);
        if (message.image) {
            const imgElement = document.createElement('img');
            imgElement.src = message.image;
            imgElement.alt = 'Uploaded image';
            imgElement.style.maxWidth = '100%';
            imgElement.style.marginTop = '10px';
            messageElement.appendChild(imgElement);
        }
        chatMessages.appendChild(messageElement);
    });
    hljs.highlightAll();
}

function renderContent(content) {
    const renderedContent = marked(content);
    return renderedContent.replace(/\$\$(.*?)\$\$/g, (match, formula) => {
        return katex.renderToString(formula, { displayMode: true });
    }).replace(/\$(.*?)\$/g, (match, formula) => {
        return katex.renderToString(formula, { displayMode: false });
    });
}


function showLoadingScreen() {
    if (isFirstLoad) {
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading-screen';
        loadingElement.innerHTML = `<div class="spinner"></div><p>Loading model...</p>`;
        document.querySelector('.chat-container').appendChild(loadingElement);

        isFirstLoad = false;
    }
}

function hideLoadingScreen() {
    const loadingElement = document.querySelector('.loading-screen');
    if (loadingElement) {
        loadingElement.remove();
    }
}
