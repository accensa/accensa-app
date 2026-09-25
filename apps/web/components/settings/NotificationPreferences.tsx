import React, { useState, useEffect } from 'react';
import { requestNotificationPermission, playAudioAlert } from '../../lib/notifications/desktopPush';

export const NotificationPreferences: React.FC = () => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toneFreq, setToneFreq] = useState(440);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission();
    setPermission(perm);
  };

  const testAudio = () => {
    playAudioAlert(toneFreq);
  };

  return (
    <div className="notification-preferences p-4 border rounded bg-white shadow-sm">
      <h2 className="text-lg font-bold mb-4">Desktop Notifications</h2>
      
      <div className="mb-4">
        <p>Status: <strong>{permission}</strong></p>
        {permission !== 'granted' && (
          <button 
            onClick={handleRequestPermission}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Enable Push Notifications
          </button>
        )}
      </div>

      <div className="mb-4 border-t pt-4">
        <h3 className="font-semibold mb-2">Audio Alerts</h3>
        <label className="flex items-center gap-2 mb-2">
          <input 
            type="checkbox" 
            checked={soundEnabled}
            onChange={(e) => setSoundEnabled(e.target.checked)} 
          />
          Enable Sound for Incoming Payments
        </label>
        
        {soundEnabled && (
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-sm">Customize Tone Frequency (Hz)</label>
            <div className="flex gap-2">
              <input 
                type="range" 
                min="200" 
                max="1000" 
                value={toneFreq} 
                onChange={(e) => setToneFreq(Number(e.target.value))} 
                className="flex-1"
              />
              <span className="w-12 text-right">{toneFreq} Hz</span>
            </div>
            <button onClick={testAudio} className="text-sm text-blue-600 underline text-left">
              Test Audio Tone
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
