import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetDisputeChatStore,
  appendMessage,
  getRoomSalt,
  listMessages,
  type DisputeAttachment,
  type DisputeChatMessage,
} from './dispute-chat-store';

const PAYLOAD = { iv: 'aXYtYmFzZTY0', ciphertext: 'Y2lwaGVydGV4dA==' };

type NewMessage = Omit<DisputeChatMessage, 'disputeId'>;

function newMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: 'message-1',
    role: 'buyer',
    createdAt: '2026-10-18T00:00:00.000Z',
    payload: PAYLOAD,
    attachment: null,
    ...overrides,
  };
}

const ATTACHMENT: DisputeAttachment = {
  name: 'receipt.png',
  contentType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
};

afterEach(() => {
  __resetDisputeChatStore();
});

describe('dispute chat store', () => {
  describe('getRoomSalt', () => {
    it('creates a 24-character base64 salt', () => {
      const salt = getRoomSalt('dispute-1');

      expect(salt).toHaveLength(24);
      expect(salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    });

    it('returns the same salt for repeated calls on the same dispute', () => {
      const first = getRoomSalt('dispute-1');
      const second = getRoomSalt('dispute-1');

      expect(second).toBe(first);
    });

    it('returns distinct salts for distinct disputes', () => {
      const salts = new Set([
        getRoomSalt('dispute-1'),
        getRoomSalt('dispute-2'),
        getRoomSalt('dispute-3'),
      ]);

      expect(salts.size).toBe(3);
    });
  });

  describe('appendMessage / listMessages', () => {
    it('starts a room with no messages', () => {
      expect(listMessages('dispute-1')).toEqual([]);
    });

    it('stores an appended message under its dispute', () => {
      const stored = appendMessage('dispute-1', newMessage());

      expect(stored).toEqual({
        id: 'message-1',
        disputeId: 'dispute-1',
        role: 'buyer',
        createdAt: '2026-10-18T00:00:00.000Z',
        payload: PAYLOAD,
        attachment: null,
      });
      expect(listMessages('dispute-1')).toEqual([stored]);
    });

    it('retrieves messages in the order they were appended', () => {
      appendMessage(
        'dispute-1',
        newMessage({ id: 'message-1', createdAt: '2026-10-18T00:00:00.000Z' }),
      );
      appendMessage(
        'dispute-1',
        newMessage({
          id: 'message-2',
          role: 'merchant',
          createdAt: '2026-10-18T00:00:10.000Z',
        }),
      );
      appendMessage(
        'dispute-1',
        newMessage({ id: 'message-3', createdAt: '2026-10-18T00:00:20.000Z' }),
      );

      expect(listMessages('dispute-1').map((message) => message.id)).toEqual([
        'message-1',
        'message-2',
        'message-3',
      ]);
    });

    it('retains attachment metadata', () => {
      appendMessage('dispute-1', newMessage({ attachment: ATTACHMENT }));

      expect(listMessages('dispute-1')[0]?.attachment).toEqual(ATTACHMENT);
    });

    it('keeps rooms isolated from one another', () => {
      appendMessage('dispute-1', newMessage({ id: 'buyer-message' }));
      appendMessage(
        'dispute-2',
        newMessage({ id: 'merchant-message', role: 'merchant', attachment: ATTACHMENT }),
      );

      expect(listMessages('dispute-1').map((message) => message.id)).toEqual(['buyer-message']);
      expect(listMessages('dispute-2').map((message) => message.id)).toEqual(['merchant-message']);
    });
  });

  describe('__resetDisputeChatStore', () => {
    it('clears every room and its messages', () => {
      appendMessage('dispute-1', newMessage());
      appendMessage('dispute-2', newMessage({ id: 'message-2' }));

      __resetDisputeChatStore();

      expect(listMessages('dispute-1')).toEqual([]);
      expect(listMessages('dispute-2')).toEqual([]);
    });

    it('starts a fresh room, with a new salt, after the reset', () => {
      const salt = getRoomSalt('dispute-1');
      appendMessage('dispute-1', newMessage());

      __resetDisputeChatStore();

      expect(listMessages('dispute-1')).toEqual([]);
      expect(getRoomSalt('dispute-1')).not.toBe(salt);
    });
  });
});
