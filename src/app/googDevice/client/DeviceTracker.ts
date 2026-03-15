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

        // Server PID control (icon-only, tooltip shows PID)
        {
            const pidBlock = document.createElement('div');
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
            streamSection.appendChild(pidBlock);
        }

        // Net interface (hidden in single-interface mode)
        {
            const ifaceBlock = document.createElement('div');
            ifaceBlock.classList.add('net_interface', blockClass);
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
            ifaceBlock.classList.add('hidden');
            /// #endif
            if (isActive) {
                const adbProxyOption = DeviceTracker.createInterfaceOption(proxyInterfaceName, proxyInterfaceUrl);
                if (lastSelected === proxyInterfaceName || !selectedInterfaceName) {
                    adbProxyOption.selected = true;
                    selectedInterfaceUrl = proxyInterfaceUrl;
                    selectedInterfaceName = proxyInterfaceName;
                }
                selectElement.appendChild(adbProxyOption);
                const actionButton = document.createElement('button');
                actionButton.className = 'action-button update-interfaces-button active';
                actionButton.title = 'Update information';
                actionButton.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
                actionButton.setAttribute(Attribute.UDID, device.udid);
                actionButton.setAttribute(Attribute.COMMAND, ControlCenterCommand.UPDATE_INTERFACES);
                actionButton.onclick = this.onActionButtonClick;
                ifaceBlock.appendChild(actionButton);
            }
            selectElement.onchange = this.onInterfaceSelected;
            ifaceBlock.appendChild(selectElement);
            streamSection.appendChild(ifaceBlock);
        }

        // Configure stream button
        const streamEntry = StreamClientScrcpy.createEntryForDeviceList(device, blockClass, fullName, this.params);
        streamEntry && streamSection.appendChild(streamEntry);

        // Player select + direct stream link (dropdown + accent button)
        if (DeviceTracker.CREATE_DIRECT_LINKS && hasPid) {
            const players = StreamClientScrcpy.getPlayers();
            if (players.length) {
                const escapedUdid = Util.escapeUdid(device.udid);
                const playerStorageKey = `configure_stream::${escapedUdid}::player`;
                const lastPlayerFullName = localStorage && localStorage.getItem(playerStorageKey);

                const streamBlock = document.createElement('div');
                streamBlock.classList.add(blockClass, 'direct-stream');

                // Player dropdown
                const playerSelect = document.createElement('select');
                playerSelect.title = 'Select player';
                let defaultIndex = 0;
                players.forEach((playerClass, index) => {
                    const option = document.createElement('option');
                    option.value = playerClass.playerCodeName;
                    option.innerText = playerClass.playerFullName;
                    playerSelect.appendChild(option);
                    if (playerClass.playerFullName === lastPlayerFullName) {
                        defaultIndex = index;
                    }
                });
                playerSelect.selectedIndex = defaultIndex;
                streamBlock.appendChild(playerSelect);

                // Link container updated by updateLink()
                const linkName = `${DeviceTracker.AttributePrefixPlayerFor}${fullName}`;
                const playerTd = document.createElement('div');
                playerTd.classList.add('player-link');
                playerTd.setAttribute('name', encodeURIComponent(linkName));
                playerTd.setAttribute(DeviceTracker.AttributePlayerFullName, encodeURIComponent('Stream'));
                playerTd.setAttribute(
                    DeviceTracker.AttributePlayerCodeName,
                    encodeURIComponent(players[defaultIndex].playerCodeName),
                );
                streamBlock.appendChild(playerTd);

                // When player changes: update playerTd, persist, re-render link
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
                    // Find current interface URL from the interface select for this device
                    const ifaceSelectName = encodeURIComponent(
                        `${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`,
                    );
                    const ifaceSelect = document.querySelector<HTMLSelectElement>(
                        `select[name="${ifaceSelectName}"]`,
                    );
                    const url =
                        ifaceSelect?.selectedOptions[0]?.getAttribute(Attribute.URL) || selectedInterfaceUrl;
                    const iface =
                        ifaceSelect?.selectedOptions[0]?.getAttribute(Attribute.NAME) || selectedInterfaceName;
                    if (url) {
                        this.updateLink({ url, name: iface, fullName, udid: device.udid, store: false });
                    }
                };

                streamSection.appendChild(streamBlock);
            }
        }

        services.appendChild(streamSection);

        // ── Dev tools section (active devices only) ────────────────────
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
            restartLabel.innerText = 'restart';
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

    protected buildDeviceTable(): void {
        super.buildDeviceTable();
        const nameEl = document.getElementById(`${this.elementId}_name`);
        if (!nameEl || nameEl.querySelector('.restart-adb-button')) {
            return;
        }
        const button = document.createElement('button');
        button.className = 'action-button restart-adb-button active';
        button.title = 'Restart ADB (refresh all devices)';
        button.setAttribute(Attribute.COMMAND, ControlCenterCommand.RESTART_ADB);
        button.onclick = this.onActionButtonClick;
        button.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
        const label = document.createElement('span');
        label.innerText = 'Restart ADB';
        button.appendChild(label);
        nameEl.appendChild(button);
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
