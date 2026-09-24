import React, { useState } from 'react';
import { BatchUploadModal } from '../../../components/refunds/BatchUploadModal';

export default function BatchRefundPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Hardcoded or fetched escrow balance for merchant
  const escrowBalance = 10000.00;

  return (
    <div className="batch-refund-page">
      <h1>Batch Refund Processing</h1>
      <button onClick={() => setIsModalOpen(true)}>
        Open Batch Upload
      </button>

      {isModalOpen && (
        <BatchUploadModal 
          escrowBalance={escrowBalance} 
          onClose={() => setIsModalOpen(false)} 
        />
      )}
    </div>
  );
}
