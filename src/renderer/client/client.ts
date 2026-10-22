// Copyright (C) 2025  HighLite

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { Highlite } from '@ryelite/core'
import { Reflector } from '@ryelite/core'
import { HighliteResources } from '@ryelite/core';
import '@iconify/iconify';
import '@static/css/index.css';
import '@static/css/overrides.css';
import '@static/css/item-tooltip.css';

import './helpers/titlebarHelpers.js';
import { setupWorldSelectorObserver } from './helpers/worldSelectHelper';

// Load settings via centralized API (values are available via window.settings)
await window.settings.getAll();

async function obtainGameClient() {
    const highspellAssetsURL = 'https://api.openspell.dev/assetsClient';

    const highliteResources = new HighliteResources();
    await highliteResources.init();

    // Check if clientLastVersion is set
    const clientLastVersion = await highliteResources.getItem('clientLastVersion');

    // Get Asset JSON to determine latest version
    const highSpellAssetJSON = await fetch(highspellAssetsURL).then(r => r.json());
    const remoteLastVersion = highSpellAssetJSON.data.latestClientVersion;

    // Load the stored hooks
    const savedHooks = await Reflector.hasSavedHooks();

    // Fetch the latest client
    async function fetchLatestClient() {

        // Define the highspell url
        const highSpellClientURL = `https://cdn.openspell.dev/js/client/client.${highSpellAssetJSON.data.latestClientVersion}.js`;

        // Log the url
        console.log(highSpellClientURL);

        // Return the new client code
        return await fetch(highSpellClientURL + '?time=' + Date.now()).then(r => r.text());
    }

    let highSpellClient : string | null = null;
    if (
        clientLastVersion == undefined ||
        clientLastVersion < remoteLastVersion ||
        !savedHooks
    ) {
        console.log(
            '[Highlite Loader] High Spell Client Version is outdated, updating...'
        );

        // Fetch the latest client
        highSpellClient = await fetchLatestClient();

        // Reflect the game hooks
        await Reflector.loadHooksFromSource(highSpellClient);

        // Inject the hook handlers. OpenSpell's client is split into several
        // strict-mode modules, so a scope-capturing probe goes into each one
        // and get/set search every scope (as OpenLiteDesktop does).
        const hookCode = `window.highliteScopes = window.highliteScopes || [];
        window.highliteScopes.push(function (a) {
            return eval(a);
        });
        if (!document.client) {
            document.client = {};
            document.client.get = function (a) {
                for (let i = 0; i < window.highliteScopes.length; i++) {
                    try {
                        let res = window.highliteScopes[i](a);
                        if (res !== undefined) return res;
                    } catch (e) {}
                }
            };
            document.client.set = function (a, b) {
                for (let i = 0; i < window.highliteScopes.length; i++) {
                    try {
                        window.highliteScopes[i](a + " = " + b);
                        return;
                    } catch (e) {}
                }
            };
        }`;
        if (highSpellClient.includes('"use strict";')) {
            highSpellClient = highSpellClient.replace(/"use strict";/g, '"use strict";' + hookCode);
        } else {
            highSpellClient = highSpellClient.replace(/\{/, '{' + hookCode);
        }

        // Save latest version
        await highliteResources.setItem('highSpellClient', highSpellClient);
        await highliteResources.setItem('clientLastVersion', remoteLastVersion);
        console.log(
            '[Highlite Loader] High Spell Client Version ' +
                highSpellAssetJSON.data.latestClientVersion +
                ' downloaded.'
        );
    } else {
        console.log(
            '[Highlite Loader] High Spell Client Version is up to date.'
        );

        // Load the client from save db
        highSpellClient = await highliteResources.getItem('highSpellClient');

        // Load the hooks from db
        await Reflector.loadHooksFromDB();

        // In the background we still bind the latest hook code for dev testing purposes (e.g finding new hooks in a script)
        setTimeout(async() => {

            // Reflect the game hooks
            await Reflector.loadHooksFromSource(highSpellClient || '');
        }, 200);
    }

    return Promise.resolve(highSpellClient);
}

// OpenSpell's play page carries the CSRF token the game form needs.
const playResponse = await fetch('https://openspell.dev/play', { credentials: 'include' });
const playDoc = new DOMParser().parseFromString(await playResponse.text(), 'text/html');
const csrfToken = playDoc.querySelector('input[name="_csrf"]')?.getAttribute('value');
if (!csrfToken) console.error('[OpenLite] No CSRF token on https://openspell.dev/play');

// POST Request to https://openspell.dev/game
const urlencoded = new URLSearchParams();
if (csrfToken) urlencoded.append('_csrf', csrfToken);
urlencoded.append('submit', 'World+1');
urlencoded.append('serverid', '1');
urlencoded.append('serverurl', 'https://server1.openspell.dev');

const response = await fetch('https://openspell.dev/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: urlencoded,
    redirect: 'follow',
    credentials: 'include'
});
const text = await response.text();

const parser = new DOMParser();
const doc = parser.parseFromString(text, 'text/html');
const clientJS = doc.querySelector('script[src*="/js/client/client"]');
if (clientJS) {
    clientJS.remove();
}

// Replace head and body content (non-script)
Array.from(doc.head.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'script') {
        // If child has a relative href, update it to absolute
        if (child.hasAttribute('href')) {
            const href = child.getAttribute('href');
            if (href && href.startsWith('/')) {
                child.setAttribute('href', 'https://openspell.dev' + href);
            }
        }
        document.head.appendChild(child.cloneNode(true));
    }
});

Array.from(doc.body.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'script') {
        // If child has a relative href, update it to absolute
        if (child.hasAttribute('href')) {
            const href = child.getAttribute('href');
            if (href && href.startsWith('/')) {
                child.setAttribute('href', 'https://openspell.dev' + href);
            }
        }

        // Append the child
        document.body.appendChild(child.cloneNode(true));
    }
});

// Process and inject scripts manually
const scripts = doc.querySelectorAll('script');
scripts.forEach(script => {
    const newScript = script.cloneNode(true);
    // if script was in head, append to head
    if (
        script.parentNode &&
        (script.parentNode as Element).tagName?.toLowerCase() === 'head'
    ) {
        document.head.appendChild(newScript);
    } else {
        // if script was in body, append to body
        document.body.appendChild(newScript);
    }
});

/* Find DOM elements with the attribute to= */
const toElements = document.querySelectorAll('[to]');
toElements.forEach(element => {
    const to = element.getAttribute('to');
    if (!to) return;
    const targetElement = document.querySelector(to);

    // Check if the element has a before or after attribute
    const before = element.getAttribute('before');
    const after = element.getAttribute('after');

    // If before is set, insert the element before the target element
    if (before && !after) {
        const beforeElement = document.querySelector(before);
        if (beforeElement && beforeElement.parentNode) {
            element.remove();
            beforeElement.parentNode.insertBefore(element, beforeElement);
        }
    } else if (after && !before) {
        // If after is set, insert the element after the target element
        const afterElement = document.querySelector(after);
        if (afterElement && afterElement.parentNode) {
            element.remove();
            afterElement.parentNode.insertBefore(
                element,
                afterElement.nextSibling
            );
        }
    } else if (!after && !before) {
        // If neither before nor after is set, append the element to the target element
        // This is the default behavior
        if (targetElement) {
            element.remove();
            targetElement.appendChild(element);
        }
    } else if (after && before) {
        // If both before and after are set, log a warning
        console.warn(
            'Element has both before and after attributes. Peforming default behavior.'
        );
        if (targetElement) {
            element.remove();
            targetElement.appendChild(element);
        }
    }
});

// Inject World Selector into Login Screen
setupWorldSelectorObserver();

// Page Setup Completed, Add Game Client Script
const clientScript = document.createElement('script');
clientScript.id = 'highspellClientScript';
clientScript.textContent = await obtainGameClient();
document.body.append(clientScript);

// Page Setup Completed, Add User Helper Script
import('./helpers/userHelper').then(module => {
    module.createUserHelper();
});

if (await window.settings.getByName('Enable Plugins')) {
    let highlite = new Highlite();

    // Load and register all plugins using dynamic imports
    console.log('[Highlite] Loading plugins...');
    const loadedPlugins: Array<{ class: any; name: string; }> = [];

    try {
        const pluginModules = import.meta.glob('./plugins/*.js', { eager: true });

        for (const [path, moduleLoader] of Object.entries(pluginModules)) {
            try {
                const pluginName = path.split('/').pop()?.replace('.js', '') || 'UnknownPlugin';
                // Dynamically import the plugin module
                const PluginClass = (moduleLoader as any).default;

                if (PluginClass) {
                    highlite.pluginManager.registerPlugin(PluginClass);
                    loadedPlugins.push({
                        class: PluginClass,
                        name: pluginName,
                    });
                } else {
                    console.error(`[Highlite] Plugin class not found in module: ${pluginName}`);
                }
            } catch (error) {
                console.error(`[Highlite] Failed to load plugin from ${path}:`, error);
            }
        }
    } catch (error) {
        console.error('[Highlite] Error loading plugins:', error);
    }
    await highlite.start();
} else {
    for (const element of document.getElementsByClassName('highlite-ui')) {
        element.remove();
    }
}
window.electron.ipcRenderer.send('ui-ready');
document.dispatchEvent(
    new Event('DOMContentLoaded', {
        bubbles: true,
        cancelable: true,
    })
);

