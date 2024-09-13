const chatMessages = document.getElementById('chat-messages');
const userMessage = document.getElementById('user-message');
const sendButton = document.getElementById('send-button');
const stopButton = document.getElementById('stop-button');
const modelSelect = document.getElementById('model-select');
const visionModelSelect = document.getElementById('vision-model-select');
const chatTitle = document.getElementById('chat-title');
const imageUpload = document.getElementById('image-upload');
const uploadButton = document.getElementById('upload-button');
const imagePreview = document.createElement('img');
const saveChatButton = document.getElementById('save-chat-button');

let messageHistory = [];
let isGenerating = false;
let currentModel = '';
let currentVisionModel = 'minicpm-v';
let currentUploadedImage = null;
let controller;

marked.setOptions({
    highlight: function(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

async function fetchModels() {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (!response.ok) {
            throw new Error('Failed to fetch models');
        }
        const data = await response.json();
        const models = data.models; // Adjusted to match the data structure
        populateModelSelect(models);
    } catch (error) {
        console.error('Error fetching models:', error);
    }
}

function populateModelSelect(models) {
    modelSelect.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name; // Use model.name as the identifier
        const modelName = `${model.details.family} (${model.details.parameter_size})`;
        option.textContent = modelName;
        option.dataset.fullName = model.name; // Store the full model name if needed
        modelSelect.appendChild(option);
    });
    if (models.length > 0) {
        currentModel = models[0].name;
        chatTitle.textContent = `Shrey's Chat with ${modelSelect.options[0].textContent}`;
    }
}

function getModelName(modelName) {
    const selectedOption = modelSelect.querySelector(`option[value="${modelName}"]`);
    return selectedOption ? selectedOption.textContent : modelName;
}

async function initializeModel() {
    try {
        const data = {
            model: currentModel,
            messages: [{ role: 'system', content: 'Initialize model' }]
        };
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Failed to initialize model');
        }
        // Discard the response
        const reader = response.body.getReader();
        while (true) {
            const { done } = await reader.read();
            if (done) break;
        }
    } catch (error) {
        console.error('Error initializing model:', error);
    }
}

// Populate vision model select similarly
function populateVisionModelSelect(models) {
    visionModelSelect.innerHTML = '';
    const visionModels = models.filter(model => model.details.families && model.details.families.includes('clip'));
    visionModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        const modelName = `${model.details.family} (${model.details.parameter_size})`;
        option.textContent = modelName;
        visionModelSelect.appendChild(option);
    });
    if (visionModels.length > 0) {
        currentVisionModel = visionModels[0].name;
    }
}

async function fetchMiniCPMVResponse(model, prompt, base64Images) {
    const url = "http://localhost:11434/api/generate";
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
        throw error;
    }
}

async function fetchLlamaResponse(messages, controller) {
    const url = "http://localhost:11434/api/chat";
    const headers = {"Content-Type": "application/json"};
    const data = {
        "model": currentModel,
        "messages": messages
    };

    try {
        const startTime = Date.now();
        let charCount = 0;

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data),
            signal: controller.signal
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
                            const newText = parsedLine.message.content;
                            partialResponse += newText;
                            charCount += newText.length;

                            updateAssistantMessage(partialResponse);
                            
                            const elapsedTime = (Date.now() - startTime) / 1000;
                            const speed = charCount / elapsedTime;
                            updateStats(elapsedTime, speed);
                        }
                    } catch (error) {
                        console.error('Error parsing JSON:', error);
                    }
                }
            }
        }

        return partialResponse;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Fetch aborted');
            return 'Response aborted by user';
        } else {
            console.error("Error in fetchLlamaResponse:", error);
            return "Error generating response";
        }
    }
}

function updateAssistantMessage(content) {
    const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop === chatMessages.clientHeight;
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
    if (isAtBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

async function handleSendMessage() {
    const message = userMessage.value.trim();
    if (message && !isGenerating) {
        isGenerating = true;
        sendButton.disabled = true;
        stopButton.disabled = false;
        //showLoadingScreen();

        let fullPrompt = message;
        if (currentUploadedImage) {
            const miniCPMVResponse = await fetchMiniCPMVResponse(currentVisionModel, message, [currentUploadedImage]);
            fullPrompt = `User uploaded an image with prompt: "${message}", answer the prompt with this info "${miniCPMVResponse}"`;
        }

        addMessage('user', message, currentUploadedImage);
        userMessage.value = '';
        currentUploadedImage = null;
        imagePreview.src = '';
        imagePreview.style.display = 'none';

        controller = new AbortController();
        const llamaResponse = await fetchLlamaResponse([...messageHistory, { role: 'user', content: fullPrompt }], controller);
        addMessage('assistant', llamaResponse);

        isGenerating = false;
        sendButton.disabled = false;
        stopButton.disabled = true;
        //hideLoadingScreen();
    }
}

sendButton.addEventListener('click', handleSendMessage);

userMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isGenerating) {
        handleSendMessage();
    }
});

stopButton.addEventListener('click', () => {
    if (controller) {
        controller.abort();
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
});

visionModelSelect.addEventListener('change', (e) => {
    currentVisionModel = e.target.value;
});

saveChatButton.addEventListener('click', saveChatHistory);

function addMessage(role, content, image = null) {
    messageHistory.push({ role, content, image });
    if (messageHistory.length > 10) {
        messageHistory.shift();
    }
    updateChatMessages();
}

function updateChatMessages() {
    const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop === chatMessages.clientHeight;
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
            imgElement.src = 'data:image/png;base64,' + message.image;
            imgElement.alt = 'Uploaded image';
            imgElement.style.maxWidth = '100%';
            imgElement.style.marginTop = '10px';
            messageElement.appendChild(imgElement);
        }
        chatMessages.appendChild(messageElement);
    });
    hljs.highlightAll();
    if (isAtBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
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
    let loadingElement = document.querySelector('.loading-screen');
    if (!loadingElement) {
        loadingElement = document.createElement('div');
        loadingElement.className = 'loading-screen';
        loadingElement.innerHTML = `<div class="spinner"></div><p>Loading model...</p>`;
        document.querySelector('.chat-container').appendChild(loadingElement);
    }
}

function hideLoadingScreen() {
    const loadingElement = document.querySelector('.loading-screen');
    if (loadingElement) {
        loadingElement.remove();
    }
}

function updateStats(elapsedTime, speed) {
    const statsElement = document.getElementById('stats');
    statsElement.textContent = `Time: ${elapsedTime.toFixed(2)}s, Speed: ${speed.toFixed(2)} chars/s`;
}
/*
async function saveChatHistory() {
    try {
        const response = await fetch('http://localhost:11434/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messageHistory })
        });
        if (!response.ok) {
            throw new Error('Failed to save chat history');
        }
        const result = await response.json();
        alert('Chat history saved successfully!');
    } catch (error) {
        console.error('Error saving chat history:', error);
        alert('Failed to save chat history.');
    }
}
    */

document.addEventListener('DOMContentLoaded', async () => {
    sendButton.disabled = false;
    stopButton.disabled = true;
    //showLoadingScreen();
    await fetchModels();
    await initializeModel();
    //hideLoadingScreen();
});