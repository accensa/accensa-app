import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'introduction',
    'architecture',
    {
      type: 'category',
      label: 'accensa-app',
      items: [
        'app/overview',
        'app/receipt-leaves',
        'onboarding',
        'user-guides',
        {
          type: 'link',
          label: 'GitHub Repository',
          href: 'https://github.com/accensa/accensa-app',
        },
      ],
    },
    {
      type: 'category',
      label: 'accensa-contracts',
      items: [
        'contracts/overview',
        {
          type: 'link',
          label: 'Mechanics',
          href: 'https://github.com/accensa/accensa-contracts/blob/main/docs/mechanics.md',
        },
        {
          type: 'link',
          label: 'Contracts',
          href: 'https://github.com/accensa/accensa-contracts/blob/main/docs/contracts.md',
        },
        {
          type: 'link',
          label: 'GitHub Repository',
          href: 'https://github.com/accensa/accensa-contracts',
        },
      ],
    },
    {
      type: 'category',
      label: 'x402-facilitator-stellar',
      items: [
        'facilitator/overview',
        'facilitator/seller',
        'facilitator/buyer-agent',
        'facilitator/operator',
        'facilitator/conformance',
        'facilitator/sync-mechanism',
        {
          type: 'link',
          label: 'GitHub Repository',
          href: 'https://github.com/accensa/x402-facilitator-stellar',
        },
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        {
          type: 'link',
          label: 'Demo Merchant (accensa-app)',
          href: 'https://github.com/accensa/accensa-app/tree/main/apps/demo-merchant',
        },
        {
          type: 'link',
          label: 'HTTP Seller (facilitator)',
          href: 'https://github.com/accensa/x402-facilitator-stellar/tree/main/examples/http-seller',
        },
        {
          type: 'link',
          label: 'MCP Agent (facilitator)',
          href: 'https://github.com/accensa/x402-facilitator-stellar/tree/main/examples/mcp-agent',
        },
      ],
    },
    {
      type: 'category',
      label: 'General Guides',
      items: ['developer', 'contributing', 'troubleshooting', 'faq'],
    },
  ],
};

export default sidebars;
