import '../../../style/devicelist.css';
import { BaseDeviceTracker } from '../../client/BaseDeviceTracker';
import { SERVER_PORT } from '../../../common/Constants';
import { ACTION } from '../../../common/Action';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import SvgImage from '../../ui/SvgImage';
import { html } from '../../ui/HtmlTag';
import Util from '../../Util';
import { Attribute } from '../../Attribute';
import { DeviceState } from '../../../common/DeviceState';
import { Message } from '../../../types/Message';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { HostItem } from '../../../types/Configuration';
import { ChannelCode } from '../../../common/ChannelCode';
import { Tool } from '../../client/Tool';


export class DeviceTracker extends BaseDeviceTracker<GoogDeviceDescriptor, never> {
    public static readonly ACTION = ACTION.GOOG_DEVICE_LIST;
    public static readonly CREATE_DIRECT_LINKS = true;
    private static readonly SORT_KEY = 'device_list::sort_order';
    private static instancesByUrl: Map<string, DeviceTracker> = new Map();
    protected static tools: Set<Tool> = new Set();
    protected tableId = 'goog_device_list';

    public static start(hostItem: HostItem): DeviceTracker {
        const url = this.buildUrlForTracker(hostItem).toString();
        let instance = this.instancesByUrl.get(url);
        if (!instance) {
            instance = new DeviceTracker(hostItem, url);
        }
        return instance;
    }

    public static getInstance(hostItem: HostItem): DeviceTracker {
        return this.start(hostItem);
    }

    protected constructor(params: HostItem, directUrl: string) {
        super({ ...params, action: DeviceTracker.ACTION }, directUrl);
        DeviceTracker.instancesByUrl.set(directUrl, this);
        this.buildDeviceTable();
        this.openNewConnection();
    }

    protected onSocketOpen(): void {
        // nothing here;
    }

    protected setIdAndHostName(id: string, hostName: string): void {
        super.setIdAndHostName(id, hostName);
        for (const value of DeviceTracker.instancesByUrl.values()) {
            if (value.id === id && value !== this) {
                console.warn(
                    `Tracker with url: "${this.url}" has the same id(${this.id}) as tracker with url "${value.url}"`,
                );
                console.warn(`This tracker will shut down`);
                this.destroy();
            }
        }
    }

    onInterfaceSelected = (event: Event): void => {
        const selectElement = event.currentTarget as HTMLSelectElement;
        const option = selectElement.selectedOptions[0];
        const url = decodeURI(option.getAttribute(Attribute.URL) || '');
        const name = option.getAttribute(Attribute.NAME) || '';
        const fullName = decodeURIComponent(selectElement.getAttribute(Attribute.FULL_NAME) || '');
        const udid = selectElement.getAttribute(Attribute.UDID) || '';
        this.updateLink({ url, name, fullName, udid, store: true });
    };

    private updateLink(params: { url: string; name: string; fullName: string; udid: string; store: boolean }): void {
        const { url, name, fullName, udid, store } = params;
        const playerTds = document.getElementsByName(
            encodeURIComponent(`${DeviceTracker.AttributePrefixPlayerFor}${fullName}`),
        );
        if (typeof udid !== 'string') {
            return;
        }
        if (store) {
            const localStorageKey = DeviceTracker.getLocalStorageKey(fullName || '');
            if (localStorage && name) {
                localStorage.setItem(localStorageKey, name);
            }
        }
        const action = ACTION.STREAM_SCRCPY;
        playerTds.forEach((item) => {
            item.innerHTML = '';
            const playerFullName = item.getAttribute(DeviceTracker.AttributePlayerFullName);
            const playerCodeName = item.getAttribute(DeviceTracker.AttributePlayerCodeName);
            if (!playerFullName || !playerCodeName) {
                return;
            }
            const link = DeviceTracker.buildLink(
                {
                    action,
                    udid,
                    player: decodeURIComponent(playerCodeName),
                    ws: url,
                },
                decodeURIComponent(playerFullName),
                this.params,
            );
            item.appendChild(link);
        });
    }

    onActionButtonClick = (event: MouseEvent): void => {
        const button = event.currentTarget as HTMLButtonElement;
        const udid = button.getAttribute(Attribute.UDID);
        const pidString = button.getAttribute(Attribute.PID) || '';
        const command = button.getAttribute(Attribute.COMMAND) as string;
        const pid = parseInt(pidString, 10);
        const data: Message = {
            id: this.getNextId(),
            type: command,
            data: {
                udid: typeof udid === 'string' ? udid : undefined,
                pid: isNaN(pid) ? undefined : pid,
            },
        };

        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    };

    private static getLocalStorageKey(udid: string): string {
        return `device_list::${udid}::interface`;
    }

    protected static createUrl(params: ParamsDeviceTracker, udid = ''): URL {
        const secure = !!params.secure;
        const hostname = params.hostname || location.hostname;
        const port = typeof params.port === 'number' ? params.port : secure ? 443 : 80;
        const pathname = params.pathname || location.pathname;
        const urlObject = this.buildUrl({ ...params, secure, hostname, port, pathname });
        if (udid) {
            urlObject.searchParams.set('action', ACTION.PROXY_ADB);
            urlObject.searchParams.set('remote', `tcp:${SERVER_PORT.toString(10)}`);
            urlObject.searchParams.set('udid', udid);
        }
        return urlObject;
    }

    protected static createInterfaceOption(name: string, url: string): HTMLOptionElement {
        const optionElement = document.createElement('option');
        optionElement.setAttribute(Attribute.URL, url);
        optionElement.setAttribute(Attribute.NAME, name);
        optionElement.innerText = `proxy over adb`;
        return optionElement;
    }

protected buildDeviceRow(tbody: Element, device: GoogDeviceDescriptor): void {
        let selectedInterfaceUrl = '';
        let selectedInterfaceName = '';
        const blockClass = 'desc-block';
        const fullName = `${this.id}_${Util.escapeUdid(device.udid)}`;
        const isActive = device.state === DeviceState.DEVICE;
        const servicesId = `device_services_${fullName}`;
        const row = html`<div class="device ${isActive ? 'active' : 'not-active'}">
            <div class="device-header">
                <div class="device-name">${device['ro.product.manufacturer']} ${device['ro.product.model']}</div>
                <div class="device-serial">${device.udid}</div>
                <div class="device-version">
                    <div class="release-version">${device['ro.build.version.release']}</div>
                    <div class="sdk-version">${device['ro.build.version.sdk']}</div>
                </div>
                <div class="device-state" title="State: ${device.state}"></div>
            </div>
            <div id="${servicesId}" class="services"></div>
        </div>`.content;
        const services = row.getElementById(servicesId);
        if (!services) {
            return;
        }

        // ── Stream section ─────────────────────────────────────────────
        const streamSection = document.createElement('div');
        streamSection.className = 'services-section stream-section';

        const pidValue = '' + device['pid'];
        const hasPid = pidValue !== '-1';

        // PID control button (cancel/start/offline)
        const pidBlock = document.createElement('div');
        {
            pidBlock.classList.add('server_pid', blockClass);
            const actionButton = document.createElement('button');
            actionButton.className = 'action-button kill-server-button';
            actionButton.setAttribute(Attribute.UDID, device.udid);
            actionButton.setAttribute(Attribute.PID, pidValue);
            let command: string;
            if (isActive) {
                actionButton.classList.add('active');
                actionButton.onclick = this.onActionButtonClick;
                if (hasPid) {
                    command = ControlCenterCommand.KILL_SERVER;
                    actionButton.title = `Kill server (PID ${pidValue})`;
                    actionButton.appendChild(SvgImage.create(SvgImage.Icon.CANCEL));
                } else {
                    command = ControlCenterCommand.START_SERVER;
                    actionButton.title = 'Start server';
                    actionButton.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
                }
                actionButton.setAttribute(Attribute.COMMAND, command);
            } else {
                const timestamp = device['last.update.timestamp'];
                if (timestamp) {
                    const date = new Date(timestamp);
                    actionButton.title = `Last update on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
                } else {
                    actionButton.title = 'Not active';
                }
                actionButton.appendChild(SvgImage.create(SvgImage.Icon.OFFLINE));
            }
            pidBlock.appendChild(actionButton);
        }

        // Net interface select + update-interfaces button
        // Clicking the update button opens the native select picker directly.
        let updateIfaceButton: HTMLButtonElement | null = null;
        let ifaceSelectElement: HTMLSelectElement | null = null;
        {
            const proxyInterfaceUrl = DeviceTracker.createUrl(this.params, device.udid).toString();
            const proxyInterfaceName = 'proxy';
            const localStorageKey = DeviceTracker.getLocalStorageKey(fullName);
            const lastSelected = localStorage && localStorage.getItem(localStorageKey);
            const selectElement = document.createElement('select');
            selectElement.setAttribute(Attribute.UDID, device.udid);
            selectElement.setAttribute(Attribute.FULL_NAME, fullName);
            selectElement.setAttribute(
                'name',
                encodeURIComponent(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`),
            );
            Object.assign(selectElement.style, {
                position: 'absolute',
                opacity: '0',
                pointerEvents: 'none',
                width: '1px',
                height: '1px',
            });
            /// #if SCRCPY_LISTENS_ON_ALL_INTERFACES
            device.interfaces.forEach((value) => {
                const params = {
                    ...this.params,
                    secure: false,
                    hostname: value.ipv4,
                    port: SERVER_PORT,
                };
                const url = DeviceTracker.createUrl(params).toString();
                const optionElement = DeviceTracker.createInterfaceOption(value.name, url);
                optionElement.innerText = `${value.name}: ${value.ipv4}`;
                selectElement.appendChild(optionElement);
                if (lastSelected) {
                    if (lastSelected === value.name || !selectedInterfaceName) {
                        optionElement.selected = true;
                        selectedInterfaceUrl = url;
                        selectedInterfaceName = value.name;
                    }
                } else if (device['wifi.interface'] === value.name) {
                    optionElement.selected = true;
                }
            });
            /// #else
            selectedInterfaceUrl = proxyInterfaceUrl;
            selectedInterfaceName = proxyInterfaceName;
            /// #endif
            if (isActive) {
                const adbProxyOption = DeviceTracker.createInterfaceOption(proxyInterfaceName, proxyInterfaceUrl);
                if (lastSelected === proxyInterfaceName || !selectedInterfaceName) {
                    adbProxyOption.selected = true;
                    selectedInterfaceUrl = proxyInterfaceUrl;
                    selectedInterfaceName = proxyInterfaceName;
                }
                selectElement.appendChild(adbProxyOption);
                const btn = document.createElement('button');
                btn.className = 'action-button update-interfaces-button active';
                btn.title = 'Update interfaces';
                btn.appendChild(SvgImage.create(SvgImage.Icon.MORE));
                btn.setAttribute(Attribute.UDID, device.udid);
                btn.setAttribute(Attribute.COMMAND, ControlCenterCommand.UPDATE_INTERFACES);
                btn.onclick = (e) => {
                    this.onActionButtonClick(e);
                    if ('showPicker' in selectElement) {
                        (selectElement as any).showPicker();
                    }
                };
                updateIfaceButton = btn;
            }
            selectElement.onchange = this.onInterfaceSelected;
            ifaceSelectElement = selectElement;
        }

        // ── Stream pill: [Stream link][player▼][⚙ configure][🔄 update iface][✕ pid] ──
        if (DeviceTracker.CREATE_DIRECT_LINKS && hasPid) {
            const players = StreamClientScrcpy.getPlayers();
            if (players.length) {
                const escapedUdid = Util.escapeUdid(device.udid);
                const playerStorageKey = `configure_stream::${escapedUdid}::player`;
                const lastPlayerFullName = localStorage && localStorage.getItem(playerStorageKey);

                let defaultIndex = 0;
                players.forEach((playerClass, index) => {
                    if (playerClass.playerFullName === lastPlayerFullName) {
                        defaultIndex = index;
                    }
                });

                const streamPill = document.createElement('div');
                streamPill.className = 'stream-pill';

                // 1. Stream link (filled by updateLink after append)
                const linkName = `${DeviceTracker.AttributePrefixPlayerFor}${fullName}`;
                const playerTd = document.createElement('div');
                playerTd.classList.add('player-link');
                playerTd.setAttribute('name', encodeURIComponent(linkName));
                playerTd.setAttribute(DeviceTracker.AttributePlayerFullName, encodeURIComponent('Stream'));
                playerTd.setAttribute(
                    DeviceTracker.AttributePlayerCodeName,
                    encodeURIComponent(players[defaultIndex].playerCodeName),
                );
                streamPill.appendChild(playerTd);

                // 2. Player select dropdown
                const playerSelect = document.createElement('select');
                playerSelect.className = 'pill-player-select';
                playerSelect.title = 'Select player';
                players.forEach((playerClass) => {
                    const option = document.createElement('option');
                    option.value = playerClass.playerCodeName;
                    option.innerText = playerClass.playerFullName;
                    playerSelect.appendChild(option);
                });
                playerSelect.selectedIndex = defaultIndex;
                streamPill.appendChild(playerSelect);

                playerSelect.onchange = () => {
                    const chosen = players[playerSelect.selectedIndex];
                    if (!chosen) {
                        return;
                    }
                    playerTd.setAttribute(
                        DeviceTracker.AttributePlayerCodeName,
                        encodeURIComponent(chosen.playerCodeName),
                    );
                    if (localStorage) {
                        localStorage.setItem(playerStorageKey, chosen.playerFullName);
                    }
                    if (selectedInterfaceUrl) {
                        this.updateLink({
                            url: selectedInterfaceUrl,
                            name: selectedInterfaceName,
                            fullName,
                            udid: device.udid,
                            store: false,
                        });
                    }
                };

                // 3. Configure stream (settings icon, icon-only)
                const streamEntry = StreamClientScrcpy.createEntryForDeviceList(
                    device,
                    blockClass,
                    fullName,
                    this.params,
                );
                if (streamEntry) {
                    const configBtn = (streamEntry as DocumentFragment).querySelector('button');
                    if (configBtn) {
                        configBtn.innerHTML = '';
                        configBtn.title = 'Configure stream';
                        configBtn.appendChild(SvgImage.create(SvgImage.Icon.SETTINGS));
                    }
                    streamPill.appendChild(streamEntry);
                }

                // 4. Update interfaces button (refresh icon, active devices only)
                if (updateIfaceButton) {
                    const updateBlock = document.createElement('div');
                    updateBlock.classList.add('update-iface', blockClass);
                    updateBlock.appendChild(updateIfaceButton);
                    streamPill.appendChild(updateBlock);
                }

                // 5. PID control (rightmost icon)
                streamPill.appendChild(pidBlock);

                streamSection.appendChild(streamPill);
            }
        } else {
            // No active stream: minimal pill with just pid status
            const pill = document.createElement('div');
            pill.className = 'stream-pill';
            if (updateIfaceButton) {
                const updateBlock = document.createElement('div');
                updateBlock.classList.add('update-iface', blockClass);
                updateBlock.appendChild(updateIfaceButton);
                pill.appendChild(updateBlock);
            }
            pill.appendChild(pidBlock);
            streamSection.appendChild(pill);
        }

        services.appendChild(streamSection);
        if (ifaceSelectElement) {
            services.appendChild(ifaceSelectElement);
        }

        // ── Dev tools section ──────────────────────────────────────────
        const toolsEntries: (HTMLElement | DocumentFragment)[] = [];
        DeviceTracker.tools.forEach((tool) => {
            const entry = tool.createEntryForDeviceList(device, blockClass, this.params);
            if (entry) {
                if (Array.isArray(entry)) {
                    entry.forEach((item) => item && toolsEntries.push(item));
                } else {
                    toolsEntries.push(entry);
                }
            }
        });

        if (isActive) {
            const restartBlock = document.createElement('div');
            restartBlock.classList.add('restart-device', blockClass);
            const restartButton = document.createElement('button');
            restartButton.className = 'action-button restart-device-button active';
            restartButton.title = 'Restart device';
            restartButton.setAttribute(Attribute.UDID, device.udid);
            restartButton.setAttribute(Attribute.COMMAND, ControlCenterCommand.RESTART_DEVICE);
            restartButton.onclick = this.onActionButtonClick;
            const restartLabel = document.createElement('span');
            restartLabel.innerText = 'reboot';
            restartButton.appendChild(restartLabel);
            restartBlock.appendChild(restartButton);
            toolsEntries.push(restartBlock);
        }

        if (toolsEntries.length) {
            const toolsSection = document.createElement('div');
            toolsSection.className = 'services-section tools-section';
            const btnGroup = document.createElement('div');
            btnGroup.className = 'btn-group';
            toolsEntries.forEach((e) => btnGroup.appendChild(e));
            toolsSection.appendChild(btnGroup);
            services.appendChild(toolsSection);
        }

        tbody.appendChild(row);
        if (DeviceTracker.CREATE_DIRECT_LINKS && hasPid && selectedInterfaceUrl) {
            this.updateLink({
                url: selectedInterfaceUrl,
                name: selectedInterfaceName,
                fullName,
                udid: device.udid,
                store: false,
            });
        }
    }

    private getSortComparator():
        | ((a: GoogDeviceDescriptor, b: GoogDeviceDescriptor) => number)
        | null {
        const sortBy = (localStorage && localStorage.getItem(DeviceTracker.SORT_KEY)) || 'default';
        if (sortBy === 'active-first') {
            return (a, b) => {
                const aScore = a.state === DeviceState.DEVICE ? 0 : 1;
                const bScore = b.state === DeviceState.DEVICE ? 0 : 1;
                return aScore - bScore || a.udid.localeCompare(b.udid);
            };
        }
        if (sortBy === 'name-asc') {
            return (a, b) => {
                const aName = `${a['ro.product.manufacturer']} ${a['ro.product.model']}`.toLowerCase();
                const bName = `${b['ro.product.manufacturer']} ${b['ro.product.model']}`.toLowerCase();
                return aName.localeCompare(bName) || a.udid.localeCompare(b.udid);
            };
        }
        if (sortBy === 'name-desc') {
            return (a, b) => {
                const aName = `${a['ro.product.manufacturer']} ${a['ro.product.model']}`.toLowerCase();
                const bName = `${b['ro.product.manufacturer']} ${b['ro.product.model']}`.toLowerCase();
                return bName.localeCompare(aName) || a.udid.localeCompare(b.udid);
            };
        }
        return null;
    }

    protected buildDeviceTable(): void {
        const comparator = this.getSortComparator();
        if (comparator) {
            this.descriptors.sort(comparator);
        }
        super.buildDeviceTable();
        const nameEl = document.getElementById(`${this.elementId}_name`);
        if (!nameEl) {
            return;
        }

        // Sort select
        const sortSelectId = `sort_${this.elementId}`;
        const sortSelect = document.createElement('select');
        sortSelect.id = sortSelectId;
        sortSelect.name = sortSelectId;
        sortSelect.className = 'sort-select';
        sortSelect.title = 'Sort devices';
        const currentSort = (localStorage && localStorage.getItem(DeviceTracker.SORT_KEY)) || 'default';
        const sortOptions: { value: string; label: string }[] = [
            { value: 'default', label: 'Default order' },
            { value: 'active-first', label: 'Active first' },
            { value: 'name-asc', label: 'Name A→Z' },
            { value: 'name-desc', label: 'Name Z→A' },
        ];
        sortOptions.forEach(({ value, label }) => {
            const option = document.createElement('option');
            option.value = value;
            option.innerText = label;
            option.selected = value === currentSort;
            sortSelect.appendChild(option);
        });
        sortSelect.addEventListener('change', (e: Event) => {
            const val = (e.currentTarget as HTMLSelectElement).value;
            if (localStorage) {
                localStorage.setItem(DeviceTracker.SORT_KEY, val);
            }
            this.buildDeviceTable();
        });
        nameEl.appendChild(sortSelect);
    }

    protected getChannelCode(): string {
        return ChannelCode.GTRC;
    }

    public destroy(): void {
        super.destroy();
        DeviceTracker.instancesByUrl.delete(this.url.toString());
        if (!DeviceTracker.instancesByUrl.size) {
            const holder = document.getElementById(BaseDeviceTracker.HOLDER_ELEMENT_ID);
            if (holder && holder.parentElement) {
                holder.parentElement.removeChild(holder);
            }
        }
    }
}
