// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requestNotificationPermission,
  playAudioAlert,
  triggerPaymentNotification,
} from './desktopPush';

describe('desktopPush notifications and audio', () => {
  const originalNotification = Reflect.get(window, 'Notification');
  const originalAudioContext = Reflect.get(window, 'AudioContext');
  const originalWebkitAudioContext = Reflect.get(window, 'webkitAudioContext');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalNotification === undefined) {
      Reflect.deleteProperty(window, 'Notification');
    } else {
      Reflect.set(window, 'Notification', originalNotification);
    }

    if (originalAudioContext === undefined) {
      Reflect.deleteProperty(window, 'AudioContext');
    } else {
      Reflect.set(window, 'AudioContext', originalAudioContext);
    }

    if (originalWebkitAudioContext === undefined) {
      Reflect.deleteProperty(window, 'webkitAudioContext');
    } else {
      Reflect.set(window, 'webkitAudioContext', originalWebkitAudioContext);
    }
    vi.restoreAllMocks();
  });

  describe('requestNotificationPermission', () => {
    it('returns denied when Notification is absent from window', async () => {
      Reflect.deleteProperty(window, 'Notification');
      const permission = await requestNotificationPermission();
      expect(permission).toBe('denied');
    });

    it('delegates to Notification.requestPermission when present', async () => {
      const requestPermissionMock = vi.fn().mockResolvedValue('granted');
      Reflect.set(window, 'Notification', {
        requestPermission: requestPermissionMock,
      });

      const permission = await requestNotificationPermission();
      expect(permission).toBe('granted');
      expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('playAudioAlert', () => {
    it('throws an error when neither AudioContext nor webkitAudioContext is supported', () => {
      Reflect.deleteProperty(window, 'AudioContext');
      Reflect.deleteProperty(window, 'webkitAudioContext');

      expect(() => playAudioAlert(440)).toThrow('Web Audio API is not supported in this browser');
    });

    it('uses webkitAudioContext when AudioContext is absent', () => {
      Reflect.deleteProperty(window, 'AudioContext');
      const resumeMock = vi.fn().mockResolvedValue(undefined);
      const startMock = vi.fn();
      const stopMock = vi.fn();
      const connectMock = vi.fn();
      const setValueAtTimeMock = vi.fn();
      const exponentialRampToValueAtTimeMock = vi.fn();

      const webkitCtor = vi.fn().mockImplementation(() => ({
        state: 'suspended',
        resume: resumeMock,
        currentTime: 0,
        createOscillator: () => ({
          type: 'sine',
          frequency: { setValueAtTime: setValueAtTimeMock },
          connect: connectMock,
          start: startMock,
          stop: stopMock,
        }),
        createGain: () => ({
          gain: {
            setValueAtTime: setValueAtTimeMock,
            exponentialRampToValueAtTime: exponentialRampToValueAtTimeMock,
          },
          connect: connectMock,
        }),
        destination: {},
      }));

      Reflect.set(window, 'webkitAudioContext', webkitCtor);

      playAudioAlert(500);

      expect(webkitCtor).toHaveBeenCalled();
      expect(resumeMock).toHaveBeenCalled();
      expect(startMock).toHaveBeenCalled();
    });
  });

  describe('triggerPaymentNotification', () => {
    it('does nothing when permission is not granted', () => {
      const notificationCtor = vi.fn();
      Reflect.set(window, 'Notification', {
        permission: 'denied',
        // @ts-expect-error test mock
        constructor: notificationCtor,
      });

      triggerPaymentNotification({ amount: '10.00 USDC', transactionId: 'tx-123' }, true);

      expect(notificationCtor).not.toHaveBeenCalled();
    });

    it('creates a Notification, sets onclick to dispatch modal event and focus, and plays sound when requested', () => {
      const focusMock = vi.spyOn(window, 'focus').mockImplementation(() => {});
      const dispatchEventMock = vi.spyOn(window, 'dispatchEvent');

      let capturedOnclick: (() => void) | null = null;
      const closeMock = vi.fn();

      const notificationInstance = {
        set onclick(fn: () => void) {
          capturedOnclick = fn;
        },
        get onclick() {
          return capturedOnclick;
        },
        close: closeMock,
      };

      const notificationCtor = vi.fn().mockImplementation(() => notificationInstance);
      Reflect.set(window, 'Notification', notificationCtor);
      Reflect.set(window, 'permission', 'granted');

      // Mock AudioContext to avoid real audio operations
      const resumeMock = vi.fn().mockResolvedValue(undefined);
      const audioCtor = vi.fn().mockImplementation(() => ({
        state: 'running',
        resume: resumeMock,
        currentTime: 0,
        createOscillator: () => ({
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        createGain: () => ({
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        }),
        destination: {},
      }));
      Reflect.set(window, 'AudioContext', audioCtor);

      // Temporarily override permission on the constructor object itself
      Object.defineProperty(window, 'Notification', {
        value: Object.assign(notificationCtor, { permission: 'granted' }),
        writable: true,
      });

      triggerPaymentNotification(
        { amount: '50.00 USDC', transactionId: 'txn-999', avatarUrl: '/avatar.png' },
        true,
        600,
      );

      expect(notificationCtor).toHaveBeenCalledWith(
        'New Payment Confirmed',
        expect.objectContaining({
          body: 'You received a payment of 50.00 USDC',
          icon: '/avatar.png',
          tag: 'payment-notification',
        }),
      );

      expect(capturedOnclick).toBeTypeOf('function');

      // Simulate click
      if (capturedOnclick) {
        capturedOnclick();
      }

      expect(focusMock).toHaveBeenCalled();
      expect(dispatchEventMock).toHaveBeenCalled();

      const dispatchedEvent = dispatchEventMock.mock.calls.find(
        (call) => call[0] instanceof CustomEvent && call[0].type === 'open-transaction-modal',
      )?.[0] as CustomEvent;

      expect(dispatchedEvent).toBeDefined();
      expect(dispatchedEvent.detail).toEqual({ id: 'txn-999' });
      expect(closeMock).toHaveBeenCalled();
    });
  });
});
