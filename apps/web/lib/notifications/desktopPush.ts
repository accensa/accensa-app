export interface NotificationOptions {
  amount: string;
  avatarUrl?: string;
  transactionId: string;
}

let audioContext: AudioContext | null = null;

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return await Notification.requestPermission();
}

export function playAudioAlert(toneFreq: number = 440) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(toneFreq, audioContext.currentTime); // customized tone
  
  gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 1);
}

export function triggerPaymentNotification(options: NotificationOptions, playSound: boolean, toneFreq: number = 440) {
  if (Notification.permission === 'granted') {
    const notification = new Notification('New Payment Confirmed', {
      body: `You received a payment of ${options.amount}`,
      icon: options.avatarUrl || '/default-avatar.png',
      tag: 'payment-notification',
    });

    notification.onclick = function() {
      window.focus();
      // Logic to open transaction detail modal
      window.dispatchEvent(new CustomEvent('open-transaction-modal', { detail: { id: options.transactionId } }));
      notification.close();
    };

    if (playSound) {
      playAudioAlert(toneFreq);
    }
  }
}
