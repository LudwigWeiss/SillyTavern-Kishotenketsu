import { getContext } from '../../../../scripts/st-context.js';
import { extension_prompt_types, eventSource, event_types } from '../../../../script.js';

const extensionName = "Kishōtenketsu";
console.log(`${extensionName}: Initializing.`);

let storyArc = null;
let currentAct = 0;
const actsOrder = ['ki', 'sho', 'ten', 'ketsu'];
let isGenerating = false;
let isInitialized = false;
let messageCounter = 0;

async function generateNewArc() {
    if (isGenerating) return;

    const generateBtn = /** @type {HTMLButtonElement} */ (document.getElementById('kishotenketsu-generate-btn'));
    if (!generateBtn) return;

    isGenerating = true;
    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;
    
    try {
        const context = getContext();
        const characterId = context.characterId;
        const character = context.characters[characterId];

        if (!character) {
            throw new Error("Could not find the current character.");
        }

        const allWorldInfo = context.worldInfo;
        let activeLoreContent = '';
        if (allWorldInfo) {
            for (const book of Object.values(allWorldInfo)) {
                if (book.enabled) {
                    const activeEntry = book.entries.find(entry => entry.enabled);
                    if (activeEntry) {
                        activeLoreContent = activeEntry.content;
                        break;
                    }
                }
            }
        }

        const chat = context.chat;
        const recentMessages = chat.slice(-4).map(msg => `${msg.name}: ${msg.mes}`).join('\n');

        const userPrompt = /** @type {HTMLTextAreaElement} */ (document.getElementById('kishotenketsu-prompt')).value;
        const systemPrompt = `You are a master storyteller. Based on the user's prompt and the preceding context of the character, their personality, and the world lore, generate a compelling four-act kishōtenketsu story arc.\n\nUser's Prompt: ${userPrompt}\n\nCharacter Name: ${character.name}\nCharacter Description: ${character.description}\nCharacter Personality: ${character.personality}\nActive Lore: ${activeLoreContent}\nRecent Chat History:\n${recentMessages}`;

        const kishotenketsuInstruction = `
            Generate the story in the following format, with each act on a new line:
            [KI: Title for the introduction]
            [SHO: Title for the development]
            [TEN: Title for the twist]
            [KETSU: Title for the conclusion]

            Introduction (Ki): [A paragraph for the introduction act]
            Development (Sho): [A paragraph for the development act]
            Twist (Ten): [A paragraph for the twist act]
            Conclusion (Ketsu): [A paragraph for the conclusion act]
        `;
        
        const maxResponseToken = 1000;

        console.log(`${extensionName}: Sending generation request...`);

        const profileSelector = /** @type {HTMLSelectElement} */ (document.getElementById('kishotenketsu-profile-select'));
        const profileId = profileSelector.value;
        if (!profileId) {
            throw new Error("No connection profile selected.");
        }

        const content = await context.generateRaw({
            prompt: kishotenketsuInstruction,
            systemPrompt: systemPrompt,
            responseLength: maxResponseToken,
        }, profileId);

        if (!content) {
            throw new Error("Received an empty response from the API.");
        }
        
        console.log(`${extensionName}: Response received:`, content);

        storyArc = parseResponse(content);
        currentAct = 0;
        messageCounter = 0;

        injectActIntoContext(0);
        displayStoryArc();

    } catch (error) {
        console.error(`${extensionName}: Failed to generate story arc.`, error);
        const errorPanel = document.getElementById('kishotenketsu-main-content');
        if (errorPanel) {
            errorPanel.innerHTML = `<p style="color:red;">Generation failed. Check the browser console for details.</p>`;
        }
    } finally {
        isGenerating = false;
        if (generateBtn) {
            generateBtn.textContent = 'Generate New Arc';
            generateBtn.disabled = false;
        }
    }
}

function parseResponse(content) {
    const arc = {};
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    
    const actMapping = { 'KI': 'ki', 'SHO': 'sho', 'TEN': 'ten', 'KETSU': 'ketsu' };
    
    lines.forEach(line => {
        const titleMatch = line.match(/^\[(KI|SHO|TEN|KETSU):(.*?)\]/);
        if (titleMatch) {
            const actKey = actMapping[titleMatch[1]];
            if (actKey) {
                if (!arc[actKey]) arc[actKey] = {};
                arc[actKey].title = titleMatch[2].trim();
            }
            return;
        }

        const descMatch = line.match(/^(?:Introduction|Development|Twist|Conclusion)\s*\((Ki|Sho|Ten|Ketsu)\):\s*(.*)/i);
        if (descMatch) {
            const actKey = actMapping[descMatch[1].toUpperCase()];
            if (actKey) {
                if (!arc[actKey]) arc[actKey] = {};
                arc[actKey].description = descMatch[2].trim();
            }
        }
    });

    if (Object.keys(arc).length < 4) {
        console.warn(`${extensionName}: Could not parse all acts. Using response as fallback.`);
        return {
            ki: { title: "Generation Result", description: content },
            sho: { title: "", description: "" },
            ten: { title: "", description: "" },
            ketsu: { title: "", description: "" },
        };
    }

    return arc;
}

function displayStoryArc() {
    if (!storyArc) return;

    const mainContent = document.getElementById('kishotenketsu-main-content');
    if (!mainContent) return;

    let arcHtml = '<ul>';
    actsOrder.forEach((actKey, index) => {
        const act = storyArc[actKey];
        if (act && act.title && act.description) {
            arcHtml += `
                <li>
                    <strong>${act.title}</strong>
                    <p>${act.description}</p>
                    <button class="kishotenketsu-inject-btn menu_button" data-act-index="${index}">Inject</button>
                </li>`;
        }
    });
    arcHtml += '</ul>';

    mainContent.innerHTML = arcHtml;

    document.querySelectorAll('.kishotenketsu-inject-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            const actIndex = parseInt(target.dataset.actIndex, 10);
            injectActIntoContext(actIndex);
        });
    });
}

function injectActIntoContext(actIndex) {
    if (!storyArc) return;
    const act = storyArc[actsOrder[actIndex]];
    if (!act || !act.description) return;

    const context = getContext();
    const textToInject = `[Kishōtenketsu: ${act.title}]\n${act.description}`;

    context.setExtensionPrompt(
        'kishotenketsu',
        textToInject,
        extension_prompt_types.IN_PROMPT,
        4,
    );

    toastr['success'](`Act "${act.title}" injected into context.`);
    context.printMessages();
}

function onChatChanged() {
    if (!storyArc) return;

    messageCounter++;
    const intervalInput = /** @type {HTMLInputElement} */ (document.getElementById('kishotenketsu-interval'));
    const injectionInterval = parseInt(intervalInput.value, 10);

    if (messageCounter >= injectionInterval) {
        currentAct = (currentAct + 1) % actsOrder.length;
        injectActIntoContext(currentAct);
        messageCounter = 0;
    }
}

async function initializeUI() {
    if (isInitialized) return;
    isInitialized = true;

    const context = getContext();
    const settingsContainer = document.getElementById('extensions_settings2');
    if (!settingsContainer) {
        console.error(`${extensionName}: Could not find settings container.`);
        return;
    }

    // Create settings drawer
    const inlineDrawer = document.createElement('div');
    inlineDrawer.classList.add('inline-drawer');
    settingsContainer.append(inlineDrawer);

    // Create drawer toggle
    const inlineDrawerToggle = document.createElement('div');
    inlineDrawerToggle.classList.add('inline-drawer-toggle', 'inline-drawer-header');
    inlineDrawer.append(inlineDrawerToggle);

    const extensionNameElement = document.createElement('b');
    extensionNameElement.textContent = extensionName;
    inlineDrawerToggle.append(extensionNameElement);

    const inlineDrawerIcon = document.createElement('div');
    inlineDrawerIcon.classList.add('inline-drawer-icon', 'fa-solid', 'fa-circle-chevron-down', 'down');
    inlineDrawerToggle.append(inlineDrawerIcon);

    // Create settings content
    const inlineDrawerContent = document.createElement('div');
    inlineDrawerContent.classList.add('inline-drawer-content');
    inlineDrawer.append(inlineDrawerContent);

    // Load HTML content
    const response = await fetch('/scripts/extensions/third-party/SillyTavern-Kishotenketsu/dropdown.html');
    const html = await response.text();
    inlineDrawerContent.innerHTML = html;

    // Toggle functionality
    inlineDrawerToggle.addEventListener('click', function() {
        this.classList.toggle('open');
        inlineDrawerIcon.classList.toggle('down');
        inlineDrawerIcon.classList.toggle('up');
        inlineDrawerContent.classList.toggle('open');
    });

    // Populate connection profiles
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('kishotenketsu-profile-select'));
    const profiles = context.extensionSettings.connectionManager.profiles;
    const profileOptions = profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    select.innerHTML = profileOptions;
    const activeProfileId = context.extensionSettings.connectionManager.activeProfileId;
    if (activeProfileId) {
        select.value = activeProfileId;
    }

    // Add event listeners
    const generateBtn = document.getElementById('kishotenketsu-generate-btn');
    generateBtn.addEventListener('click', generateNewArc);

    // Listen for chat changes
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
}

eventSource.on(event_types.APP_READY, initializeUI);