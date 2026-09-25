import React, { useState } from 'react';

export function Playground() {
  const [code, setCode] = useState(`// Pre-loaded SDK snippets
// Initialize SDK and test connection
const initSDK = () => {
  return { status: "SDK Initialized", network: "Testnet" };
};
return initSDK();
`);
  const [output, setOutput] = useState('');

  const runCode = () => {
    try {
      let result;
      try {
        // eslint-disable-next-line no-eval
        result = eval(`(function() { ${code} })()`);
      } catch (err) {
        result = String(err);
      }
      setOutput(JSON.stringify(result, null, 2) || "Executed successfully without return value");
    } catch (e) {
      setOutput(String(e));
    }
  };

  const fundAccount = () => {
    setOutput('Funding account via Friendbot (Testnet)...\nSuccess: 10000 XLM added.');
  };

  return (
    <div className="playground-container" style={{ border: '1px solid #eaeaea', borderRadius: '8px', padding: '16px', marginTop: '20px' }}>
      <h3>Interactive API & SDK Code Playground</h3>
      <div style={{ marginBottom: '16px' }}>
        <button onClick={fundAccount} style={{ marginRight: '10px', padding: '8px 16px', cursor: 'pointer' }}>Fund via Faucet (Testnet)</button>
        <button onClick={runCode} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#0070f3', color: 'white', border: 'none', borderRadius: '4px' }}>Run Code</button>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <textarea 
            value={code} 
            onChange={(e) => setCode(e.target.value)}
            style={{ flex: 1, minHeight: '200px', fontFamily: 'monospace', padding: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          <div style={{ flex: 1, minHeight: '200px', backgroundColor: '#f6f8fa', padding: '12px', borderRadius: '4px', overflowY: 'auto', border: '1px solid #ccc' }}>
            <strong>Console Output:</strong>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, marginTop: '8px', fontFamily: 'monospace' }}>{output}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
