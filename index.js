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
let activeArcId = 'root';

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
        activeArcId = 'root';

        if (storyArc.acts.ki && storyArc.acts.ki.description) {
            injectActIntoContext(storyArc.acts.ki.id, true); // Automatically inject Ki as system message
        }
        displayStoryArc();
        generateBtn.textContent = 'Clear';

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

function parseResponse(content, parentId = 'root') {
    const arc = {
        id: parentId,
        acts: {
            ki: { id: `${parentId}-ki` },
            sho: { id: `${parentId}-sho` },
            ten: { id: `${parentId}-ten` },
            ketsu: { id: `${parentId}-ketsu` },
        },
    };
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    
    const actMapping = { 'KI': 'ki', 'SHO': 'sho', 'TEN': 'ten', 'KETSU': 'ketsu' };
    
    lines.forEach(line => {
        const titleMatch = line.match(/^\[(KI|SHO|TEN|KETSU):(.*?)\]/);
        if (titleMatch) {
            const actKey = actMapping[titleMatch[1]];
            if (actKey) {
                arc.acts[actKey].title = titleMatch[2].trim();
            }
            return;
        }

        const descMatch = line.match(/^(?:Introduction|Development|Twist|Conclusion)\s*\((Ki|Sho|Ten|Ketsu)\):\s*(.*)/i);
        if (descMatch) {
            const actKey = actMapping[descMatch[1].toUpperCase()];
            if (actKey) {
                arc.acts[actKey].description = descMatch[2].trim();
            }
        }
    });

    if (Object.values(arc.acts).some(act => !act.title || !act.description)) {
        console.warn(`${extensionName}: Could not parse all acts. Using response as fallback.`);
        return {
            id: 'root',
            acts: {
                ki: { id: 'root-ki', title: "Generation Result", description: content },
                sho: { id: 'root-sho', title: "", description: "" },
                ten: { id: 'root-ten', title: "", description: "" },
                ketsu: { id: 'root-ketsu', title: "", description: "" },
            }
        };
    }

    return arc;
}

function displayStoryArc() {
    if (!storyArc) return;

    const mainContent = document.getElementById('kishotenketsu-main-content');
    if (!mainContent) return;

    mainContent.innerHTML = renderArc(storyArc);
    addActButtonListeners();
}

function renderArc(arc, level = 0) {
    if (!arc || !arc.acts) return '';

    let arcHtml = `<ul class="arc-level-${level}" data-id="${arc.id}">`;
    actsOrder.forEach(actKey => {
        const act = arc.acts[actKey];
        if (act && act.title && act.description) {
            arcHtml += `
                <li data-id="${act.id}">
                    <strong>${act.title}</strong>
                    <p>${act.description}</p>
                    <div class="act-buttons">
                        <button class="regenerate-btn">Regenerate</button>
                        <button class="sub-arc-btn">Add Sub-Arc</button>
                    </div>
                    ${act.children ? renderArc(act.children, level + 1) : ''}
                </li>`;
        }
    });
    if (level > 0) {
        arcHtml += `<button class="set-active-arc-btn">Set Active</button>`;
    }
    arcHtml += '</ul>';
    return arcHtml;
}

function injectActIntoContext(actId, isSystem = false) {
    if (!storyArc) return;

    const act = findActById(storyArc, actId);
    if (!act || !act.description) return;

    const context = getContext();
    const textToInject = `[Kishōtenketsu: ${act.title}]\n${act.description}`;
    const promptType = isSystem ? extension_prompt_types.BEFORE_PROMPT : extension_prompt_types.IN_PROMPT;
    const depth = isSystem ? 0 : 4; // System prompts are usually at the beginning

    context.setExtensionPrompt(
        'kishotenketsu',
        textToInject,
        promptType,
        depth,
    );

    toastr['success'](`Act "${act.title}" injected as ${isSystem ? 'system message' : 'prompt'}.`);
}

function findActById(arc, actId) {
    if (!arc || !arc.acts) return null;

    for (const actKey of actsOrder) {
        const act = arc.acts[actKey];
        if (act.id === actId) {
            return act;
        }
        if (act.children) {
            const found = findActById(act.children, actId);
            if (found) return found;
        }
    }

    return null;
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

    // Append modal to body
    const modal = document.getElementById('kishotenketsu-modal');
    if (modal) {
        document.body.appendChild(modal);
    }

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
    generateBtn.addEventListener('click', () => {
        if (generateBtn.textContent === 'Generate New Arc') {
            generateNewArc();
        } else {
            clearArc();
        }
    });

    // Listen for chat changes

    const closeBtn = document.getElementById('kishotenketsu-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('kishotenketsu-modal');
            const backdrop = document.getElementById('kishotenketsu-modal-backdrop');
            if (modal) modal.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
        });
    }

    if (modal) {
        modal.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }
}

eventSource.on(event_types.APP_READY, initializeUI);
eventSource.on(event_types.CHAT_UPDATED, handleChatUpdate);

function handleChatUpdate() {
    if (!storyArc) return;

    const context = getContext();
    const lastMessage = context.chat[context.chat.length - 1];

    if (lastMessage && lastMessage.mes) {
        const injectedArcMatch = lastMessage.mes.match(/\[Kishōtenketsu: (.*?)\]/);
        if (injectedArcMatch) {
            const arcTitle = injectedArcMatch[1];
            const allActs = [];
            
            function collectActs(arc) {
                if (!arc || !arc.acts) return;
                Object.values(arc.acts).forEach(act => {
                    if (act) {
                        allActs.push(act);
                        if (act.children) {
                            collectActs(act.children);
                        }
                    }
                });
            }

            collectActs(storyArc);
            
            const foundAct = allActs.find(act => act.title === arcTitle);

            if (foundAct) {
                const actElement = document.querySelector(`li[data-id="${foundAct.id}"]`);
                if (actElement) {
                    // Remove highlight from previously injected arcs
                    document.querySelectorAll('.injected-arc').forEach(el => el.classList.remove('injected-arc'));
                    // Add highlight to the new one
                    actElement.classList.add('injected-arc');
                }
            }
        }
    }
}

function addActButtonListeners() {
    document.querySelectorAll('.regenerate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = /** @type {HTMLElement} */ (e.target);
            const actId = target.closest('li').dataset.id;
            showModal('regenerate', actId);
        });
    });

    document.querySelectorAll('.sub-arc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = /** @type {HTMLElement} */ (e.target);
            const actId = target.closest('li').dataset.id;
            showModal('sub-arc', actId);
        });
    });


    document.querySelectorAll('.set-active-arc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = /** @type {HTMLElement} */ (e.target);
            const arcId = target.closest('ul').dataset.id;
            activeArcId = arcId;
            toastr['success'](`Set active arc to: ${arcId}`);
            // Highlight the active arc
            document.querySelectorAll('.active-arc').forEach(el => el.classList.remove('active-arc'));
            target.closest('ul').classList.add('active-arc');
        });
    });
}

function showModal(type, actId) {
    const modal = document.getElementById('kishotenketsu-modal');
    const backdrop = document.getElementById('kishotenketsu-modal-backdrop');
    const title = document.getElementById('kishotenketsu-modal-title');
    const prompt = /** @type {HTMLTextAreaElement} */ (document.getElementById('kishotenketsu-modal-prompt'));
    const submitBtn = document.getElementById('kishotenketsu-modal-submit');

    if (!modal || !backdrop || !title || !prompt || !submitBtn) return;

    prompt.value = '';

    if (type === 'regenerate') {
        title.textContent = 'Regenerate Act';
        submitBtn.onclick = () => regenerateAct(actId, prompt.value);
    } else {
        title.textContent = 'Create Sub-Arc';
        submitBtn.onclick = () => createSubArc(actId, prompt.value);
    }

    modal.style.display = 'block';
    backdrop.style.display = 'block';
}

async function regenerateAct(actId, userPrompt) {
    if (isGenerating) return;
    isGenerating = true;

    try {
        const context = getContext();
        const characterId = context.characterId;
        const character = context.characters[characterId];
        const parentArc = findParentArc(storyArc, actId);
        const actToRegenerate = findActById(storyArc, actId);

        let precedingActsContent = '';
        if (parentArc) {
            for (const actKey of actsOrder) {
                const currentAct = parentArc.acts[actKey];
                if (currentAct.id === actId) break;
                precedingActsContent += `[${actKey.toUpperCase()}: ${currentAct.title}]\n${currentAct.description}\n\n`;
            }
        }

        const systemPrompt = `You are a master storyteller. The user wants to regenerate a specific act of a kishōtenketsu story arc. Based on the user's prompt, the character details, and the preceding acts, generate a new version of this act.\n\nUser's Prompt: ${userPrompt}\n\nCharacter Name: ${character.name}\nCharacter Description: ${character.description}\n\nPreceding Acts:\n${precedingActsContent}`;
        const regenerationInstruction = `Generate a new version of the act titled "${actToRegenerate.title}". Provide a new title and a new paragraph for the description in the following format:\n\n[${Object.keys(parentArc.acts).find(key => parentArc.acts[key].id === actId).toUpperCase()}: New Title]\n\nNew Description: [A new paragraph for the act]`;

        const profileSelector = /** @type {HTMLSelectElement} */ (document.getElementById('kishotenketsu-profile-select'));
        const profileId = profileSelector.value;

        const content = await context.generateRaw({
            prompt: regenerationInstruction,
            systemPrompt: systemPrompt,
            responseLength: 500,
        }, profileId);

        if (!content) {
            throw new Error("Received an empty response from the API.");
        }

        const newTitleMatch = content.match(/^\[(?:KI|SHO|TEN|KETSU):(.*?)\]/);
        const newDescriptionMatch = content.match(/New Description:\s*([\s\S]*)/);

        if (newTitleMatch && newDescriptionMatch) {
            actToRegenerate.title = newTitleMatch[1].trim();
            actToRegenerate.description = newDescriptionMatch[1].trim();
        } else {
            // Fallback if parsing fails
            actToRegenerate.description = content;
        }

        displayStoryArc();

    } catch (error) {
        console.error(`${extensionName}: Failed to regenerate act.`, error);
        toastr['error']("Failed to regenerate act. Check console for details.");
    } finally {
        isGenerating = false;
        const modal = document.getElementById('kishotenketsu-modal');
        const backdrop = document.getElementById('kishotenketsu-modal-backdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    }
}

async function createSubArc(parentActId, userPrompt) {
    if (isGenerating) return;
    isGenerating = true;

    try {
        const context = getContext();
        const characterId = context.characterId;
        const character = context.characters[characterId];
        const parentAct = findActById(storyArc, parentActId);

        const systemPrompt = `You are a master storyteller. The user wants to create a new 4-act kishōtenketsu sub-arc within an existing story. This sub-arc will replace the content of the act titled "${parentAct.title}". Based on the user's prompt and the character details, generate a compelling new four-act story.\n\nUser's Prompt: ${userPrompt}\n\nCharacter Name: ${character.name}\nCharacter Description: ${character.description}`;
        
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

        const profileSelector = /** @type {HTMLSelectElement} */ (document.getElementById('kishotenketsu-profile-select'));
        const profileId = profileSelector.value;

        const content = await context.generateRaw({
            prompt: kishotenketsuInstruction,
            systemPrompt: systemPrompt,
            responseLength: 1000,
        }, profileId);

        if (!content) {
            throw new Error("Received an empty response from the API.");
        }

        parentAct.children = parseResponse(content, `${parentActId}-arc`);
        displayStoryArc();

    } catch (error) {
        console.error(`${extensionName}: Failed to create sub-arc.`, error);
        toastr['error']("Failed to create sub-arc. Check console for details.");
    } finally {
        isGenerating = false;
        const modal = document.getElementById('kishotenketsu-modal');
        const backdrop = document.getElementById('kishotenketsu-modal-backdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    }
}

function findParentArc(arc, actId) {
    if (!arc || !arc.acts) return null;

    for (const actKey of actsOrder) {
        const act = arc.acts[actKey];
        if (act.id === actId) {
            return arc;
        }
        if (act.children) {
            const found = findParentArc(act.children, actId);
            if (found) return found;
        }
    }

    return null;
}

function clearArc() {
    storyArc = null;
    currentAct = 0;
    messageCounter = 0;
    activeArcId = 'root';

    const mainContent = document.getElementById('kishotenketsu-main-content');
    if (mainContent) {
        mainContent.innerHTML = '<p>Click "Generate New Arc" to create a story.</p>';
    }

    const generateBtn = document.getElementById('kishotenketsu-generate-btn');
    if (generateBtn) {
        generateBtn.textContent = 'Generate New Arc';
    }
}

function findArcById(arc, arcId) {
    if (arc.id === arcId) return arc;
    if (!arc.acts) return null;

    for (const actKey of actsOrder) {
        const act = arc.acts[actKey];
        if (act.children) {
            const found = findArcById(act.children, arcId);
            if (found) return found;
        }
    }

    return null;
}