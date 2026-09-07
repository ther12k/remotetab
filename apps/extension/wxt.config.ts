import { defineConfig } from 'wxt';

// RemoteTab MV3 extension. Permissions follow SECURITY_THREAT_MODEL.md §6:
// activeTab, tabCapture, debugger, storage, power, offscreen. Never add
// cookies/webRequest/history/nativeMessaging or broad host permissions.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'RemoteTab',
    version: '0.1.0',
    description:
      'Control one Chrome tab from your paired phone. Your browser login stays on this computer.',
    permissions: ['activeTab', 'tabCapture', 'debugger', 'storage', 'power', 'offscreen'],
  },
});
