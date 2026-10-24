import React, { useState, useEffect, useRef } from 'react';

export interface ContractNode {
  id: string;
  name: string;
  role: string;
  purpose: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  borderColor: string;
  interfaceMethods: string[];
  githubUrl: string;
}

const CONTRACT_NODES: ContractNode[] = [
  {
    id: 'multisig',
    name: 'Multisig Contract',
    role: 'Governance & Auth',
    purpose:
      'Implements threshold m-of-n signature verification, multi-admin authorization for parameter updates, and emergency pause controls across contracts.',
    x: 100,
    y: 70,
    width: 220,
    height: 110,
    color: 'rgba(59, 130, 246, 0.1)',
    borderColor: '#3b82f6',
    interfaceMethods: [
      'init(signers: Vec<Address>, threshold: u32)',
      'verify_auth(signatures: Vec<Signature>, hash: BytesN<32>) -> bool',
      'propose_upgrade(new_wasm_hash: BytesN<32>) -> u64',
      'execute_upgrade(proposal_id: u64)',
    ],
    githubUrl:
      'https://github.com/accensa/accensa-contracts/blob/main/contracts/multisig-account/src/lib.rs',
  },
  {
    id: 'vault',
    name: 'Vault Contract',
    role: 'Custody & Refunds',
    purpose:
      'Manages collateral lockup, escrowed merchant settlements, and trustless automated buyer refunds triggered upon dispute settlement.',
    x: 580,
    y: 70,
    width: 220,
    height: 110,
    color: 'rgba(168, 85, 247, 0.1)',
    borderColor: '#a855f7',
    interfaceMethods: [
      'deposit_collateral(merchant: Address, amount: i128)',
      'lock_funds(order_id: BytesN<32>, amount: i128)',
      'release_settlement(merchant: Address, order_id: BytesN<32>)',
      'refund_buyer(buyer: Address, order_id: BytesN<32>, proof: DisputeProof)',
    ],
    githubUrl:
      'https://github.com/accensa/accensa-contracts/blob/main/contracts/refund-vault/src/lib.rs',
  },
  {
    id: 'channel',
    name: 'Channel Contract (Design)',
    role: 'Micropayments & State',
    purpose:
      'Coordinates fast off-chain state channel channels, bilateral payment signing, cooperative channel closing, and dispute submission with evidence timeout.',
    x: 100,
    y: 310,
    width: 220,
    height: 110,
    color: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10b981',
    interfaceMethods: [
      'open_channel(buyer: Address, merchant: Address, deposit: i128) -> BytesN<32>',
      'checkpoint_state(channel_id: BytesN<32>, sequence: u64, balance_mer: i128, sigs: Vec<Signature>)',
      'initiate_dispute(channel_id: BytesN<32>, latest_state: Bytes)',
      'settle_and_close(channel_id: BytesN<32>)',
    ],
    githubUrl:
      'https://github.com/accensa/accensa-app/blob/main/docs/technical-designs/178-state-channels-sdk.md',
  },
  {
    id: 'shard',
    name: 'Shard Contract',
    role: 'Batch State Partitioning',
    purpose:
      'Partitions payment records into concurrent shards for horizontal scalability, generating deterministic Merkle partitions for cross-shard aggregation.',
    x: 580,
    y: 310,
    width: 220,
    height: 110,
    color: 'rgba(245, 158, 11, 0.1)',
    borderColor: '#f59e0b',
    interfaceMethods: [
      'record_leaf(shard_id: u32, leaf_hash: BytesN<32>) -> u64',
      'seal_epoch(shard_id: u32) -> BytesN<32>',
      'get_shard_root(shard_id: u32) -> BytesN<32>',
      'verify_inclusion(shard_id: u32, proof: Vec<BytesN<32>>, leaf: BytesN<32>) -> bool',
    ],
    githubUrl:
      'https://github.com/accensa/accensa-contracts/blob/main/contracts/receipt-shard/src/lib.rs',
  },
  {
    id: 'receipt-anchor',
    name: 'ReceiptAnchor Contract',
    role: 'Receipt Proof Registry',
    purpose:
      'Stores batch Merkle roots anchored onto the Soroban ledger, allowing merchants and AI agents to cryptographically verify receipt inclusion.',
    x: 340,
    y: 190,
    width: 220,
    height: 110,
    color: 'rgba(236, 72, 153, 0.1)',
    borderColor: '#ec4899',
    interfaceMethods: [
      'anchor_batch(batch_id: u64, root: BytesN<32>, leaf_count: u32, timestamp: u64)',
      'verify_receipt(batch_id: u64, leaf: BytesN<32>, proof: Vec<BytesN<32>>) -> bool',
      'get_batch(batch_id: u64) -> BatchRecord',
    ],
    githubUrl:
      'https://github.com/accensa/accensa-contracts/blob/main/contracts/receipt-anchor/src/lib.rs',
  },
];

type FlowType = 'all' | 'payment' | 'dispute' | 'anchor';

export function ArchitectureDiagram() {
  const [selectedNode, setSelectedNode] = useState<ContractNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeFlow, setActiveFlow] = useState<FlowType>('all');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | SVGElement | null>(null);

  const closeModal = () => {
    setSelectedNode(null);
    setTimeout(() => {
      triggerElementRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    if (selectedNode) {
      closeButtonRef.current?.focus();
    }
  }, [selectedNode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="architecture-diagram-container"
      style={{
        margin: '2rem 0',
        padding: '1.5rem',
        borderRadius: '12px',
        border: '1px solid var(--ifm-color-emphasis-200, #e5e7eb)',
        backgroundColor: 'var(--ifm-card-background-color, #ffffff)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
      }}
    >
      <style>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -28;
          }
        }
        .flow-path {
          animation: dash-flow 1.2s linear infinite;
        }
        .contract-box {
          transition: transform 0.2s ease, filter 0.2s ease;
          cursor: pointer;
        }
        .contract-box:hover,
        .contract-box:focus-visible {
          filter: brightness(1.08) drop-shadow(0 6px 14px rgba(0,0,0,0.15));
        }
        .contract-box:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .flow-path {
            animation: none;
          }
          .contract-box {
            transition: none;
          }
        }
      `}</style>

      {/* Header and Filter Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
            Interactive Soroban Architecture Diagram
          </h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', opacity: 0.75 }}>
            Hover for details. Click any contract box to inspect its interface, role, and GitHub
            source.
          </p>
        </div>

        {/* Lifecycle path toggles */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'all', label: 'All Lifecycles', color: '#6366f1' },
              { id: 'payment', label: 'Payment Flow', color: '#10b981' },
              { id: 'dispute', label: 'Dispute Lifecycle', color: '#f59e0b' },
              { id: 'anchor', label: 'Receipt Anchoring', color: '#ec4899' },
            ] as const
          ).map((flow) => (
            <button
              key={flow.id}
              type="button"
              onClick={() => setActiveFlow(flow.id)}
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                border: activeFlow === flow.id ? `2px solid ${flow.color}` : '1px solid #d1d5db',
                backgroundColor: activeFlow === flow.id ? flow.color : 'transparent',
                color: activeFlow === flow.id ? '#ffffff' : 'inherit',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {flow.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Container */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox="0 0 900 480"
          style={{
            width: '100%',
            height: 'auto',
            minWidth: '650px',
            display: 'block',
          }}
        >
          <defs>
            <marker
              id="arrow-payment"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker
              id="arrow-dispute"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            <marker
              id="arrow-anchor"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#ec4899" />
            </marker>
          </defs>

          {/* PATHS */}
          {/* Payment Flow: Channel -> Shard & Channel -> ReceiptAnchor */}
          {(activeFlow === 'all' || activeFlow === 'payment') && (
            <g>
              <path
                d="M 320 365 L 580 365"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-payment)"
              />
              <path
                d="M 320 340 Q 420 280 430 300"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-payment)"
              />
              <text
                x="450"
                y="380"
                fill="#10b981"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
              >
                Payment settlement batch
              </text>
            </g>
          )}

          {/* Dispute Lifecycle: Channel -> Multisig -> Vault */}
          {(activeFlow === 'all' || activeFlow === 'dispute') && (
            <g>
              <path
                d="M 210 310 L 210 180"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-dispute)"
              />
              <path
                d="M 320 125 L 580 125"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-dispute)"
              />
              <text x="215" y="245" fill="#f59e0b" fontSize="11" fontWeight="600">
                Dispute Proof
              </text>
              <text
                x="450"
                y="115"
                fill="#f59e0b"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
              >
                Authorized Refund Order
              </text>
            </g>
          )}

          {/* Receipt Anchoring: Shard -> ReceiptAnchor -> Vault */}
          {(activeFlow === 'all' || activeFlow === 'anchor') && (
            <g>
              <path
                d="M 580 340 Q 480 300 460 300"
                fill="none"
                stroke="#ec4899"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-anchor)"
              />
              <path
                d="M 460 190 Q 520 160 580 145"
                fill="none"
                stroke="#ec4899"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="flow-path"
                markerEnd="url(#arrow-anchor)"
              />
              <text
                x="560"
                y="245"
                fill="#ec4899"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
              >
                Merkle Root Anchor
              </text>
            </g>
          )}

          {/* CONTRACT NODES */}
          {CONTRACT_NODES.map((node) => {
            const isHovered = hoveredNodeId === node.id;
            const isSelected = selectedNode?.id === node.id;

            return (
              <g
                key={node.id}
                className="contract-box"
                onClick={(e) => {
                  triggerElementRef.current = e.currentTarget;
                  setSelectedNode(node);
                }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                tabIndex={0}
                role="button"
                aria-label={`Contract: ${node.name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerElementRef.current = e.currentTarget;
                    setSelectedNode(node);
                  }
                }}
              >
                {/* Box Background */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="10"
                  ry="10"
                  fill={isHovered || isSelected ? node.color.replace('0.1', '0.2') : node.color}
                  stroke={node.borderColor}
                  strokeWidth={isHovered || isSelected ? '3' : '2'}
                  style={{ transition: 'all 0.2s ease' }}
                />

                {/* Badge Header */}
                <rect
                  x={node.x + 10}
                  y={node.y + 10}
                  width={node.width - 20}
                  height="22"
                  rx="4"
                  ry="4"
                  fill={node.borderColor}
                  opacity="0.15"
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + 25}
                  textAnchor="middle"
                  fill={node.borderColor}
                  fontSize="11"
                  fontWeight="700"
                  letterSpacing="0.5"
                >
                  {node.role.toUpperCase()}
                </text>

                {/* Contract Name */}
                <text
                  x={node.x + node.width / 2}
                  y={node.y + 58}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="14"
                  fontWeight="700"
                >
                  {node.name}
                </text>

                {/* Click Hint */}
                <text
                  x={node.x + node.width / 2}
                  y={node.y + 88}
                  textAnchor="middle"
                  fill={node.borderColor}
                  fontSize="10"
                  fontWeight="600"
                  style={{ textDecoration: 'underline' }}
                >
                  Click to inspect →
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Contract Detail Modal */}
      {selectedNode && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-contract-title"
          onClick={closeModal}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && dialogContentRef.current) {
              const focusable = dialogContentRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              );
              if (focusable.length > 0) {
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1.5rem',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            ref={dialogContentRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '620px',
              width: '100%',
              backgroundColor: 'var(--ifm-card-background-color, #ffffff)',
              color: 'var(--ifm-color-content, #1f2937)',
              borderRadius: '12px',
              border: `2px solid ${selectedNode.borderColor}`,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
              padding: '1.75rem',
              position: 'relative',
            }}
          >
            {/* Close Button */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeModal}
              aria-label="Close details"
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                border: 'none',
                background: 'transparent',
                fontSize: '1.5rem',
                lineHeight: 1,
                cursor: 'pointer',
                color: 'inherit',
                opacity: 0.7,
              }}
            >
              ✕
            </button>

            {/* Badge */}
            <span
              style={{
                display: 'inline-block',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: selectedNode.borderColor,
                backgroundColor: selectedNode.color,
                padding: '0.2rem 0.6rem',
                borderRadius: '4px',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {selectedNode.role}
            </span>

            {/* Title */}
            <h2
              id="modal-contract-title"
              style={{
                margin: '0 0 0.75rem',
                fontSize: '1.5rem',
                fontWeight: 700,
              }}
            >
              {selectedNode.name}
            </h2>

            {/* Purpose */}
            <p style={{ fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              {selectedNode.purpose}
            </p>

            {/* Interface Section */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.4rem',
                  opacity: 0.8,
                }}
              >
                Contract Interface (Soroban Rust SDK)
              </div>
              <div
                style={{
                  backgroundColor: 'var(--ifm-code-background, #1e293b)',
                  color: '#f8fafc',
                  padding: '0.85rem 1rem',
                  borderRadius: '6px',
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.825rem',
                  lineHeight: '1.6',
                  overflowX: 'auto',
                }}
              >
                {selectedNode.interfaceMethods.map((fn, idx) => (
                  <div key={idx} style={{ color: '#38bdf8' }}>
                    <span style={{ color: '#ec4899' }}>pub fn </span>
                    {fn};
                  </div>
                ))}
              </div>
            </div>

            {/* Footer / Links */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '1rem',
                borderTop: '1px solid var(--ifm-color-emphasis-200, #e2e8f0)',
              }}
            >
              <a
                href={selectedNode.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: selectedNode.borderColor,
                  textDecoration: 'none',
                }}
              >
                View Contract on GitHub ↗
              </a>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                style={{
                  padding: '0.45rem 1rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: selectedNode.borderColor,
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArchitectureDiagram;
