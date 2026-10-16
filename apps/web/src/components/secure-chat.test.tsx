// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/lib/chat/session';
import { SecureChat } from './secure-chat';

const { mockReadStatus, mockClient, MockSecureChatClient } = vi.hoisted(() => {
  const client = {
    messages: [] as ChatMessage[],
    unlock: vi.fn(),
    send: vi.fn(),
    read: vi.fn(),
    reset: vi.fn(),
  };
  return {
    mockReadStatus: vi.fn(),
    mockClient: client,
    // A regular function (not an arrow) so `new SecureChatClient(...)` works
    // and hands the component the shared mock instance.
    MockSecureChatClient: vi.fn(function () {
      return client;
    }),
  };
});

vi.mock('@/lib/chat/secure-chat', () => ({ SecureChatClient: MockSecureChatClient }));
vi.mock('@/lib/freighter', () => ({
  readStatus: mockReadStatus,
  truncateAddress: (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`,
}));

const ADDRESS = `G${'A'.repeat(55)}`;
const TRUNCATED = 'GAAA…AAAA';

function message(id: string, role: ChatMessage['role'] = 'merchant'): ChatMessage {
  return {
    id,
    role,
    createdAt: '2026-10-01T10:00:00.000Z',
    payload: {} as ChatMessage['payload'],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function chatRegion() {
  return screen.getByRole('region', { name: 'Encrypted support chat' });
}

async function renderUnlocked() {
  const view = render(<SecureChat />);
  const composer = await screen.findByLabelText('Support message');
  const sendButton = screen.getByRole('button', { name: 'Send encrypted message' });
  return { ...view, composer, sendButton };
}

describe('SecureChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      mockReadStatus,
      mockClient.unlock,
      mockClient.send,
      mockClient.read,
      mockClient.reset,
    ]) {
      fn.mockReset();
    }
    mockClient.messages = [];
    mockReadStatus.mockResolvedValue({ kind: 'connected', address: ADDRESS });
    mockClient.unlock.mockResolvedValue({ kind: 'unlocked', fresh: false });
    mockClient.send.mockResolvedValue(undefined);
    mockClient.read.mockImplementation(async (m: ChatMessage) => `plain:${m.id}`);
    mockClient.reset.mockImplementation(() => {
      mockClient.messages = [];
    });
  });

  it('renders "Checking wallet connection" before the mount promise resolves', () => {
    mockReadStatus.mockReturnValue(new Promise(() => {}));
    render(<SecureChat />);

    expect(within(chatRegion()).getByText(/Checking wallet connection/)).toBeInTheDocument();
    expect(MockSecureChatClient).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', { kind: 'unavailable' }],
    ['disconnected', { kind: 'disconnected' }],
    ['error', { kind: 'error', message: 'Freighter failed' }],
  ])('shows the no-wallet state when the wallet is %s', async (_label, wallet) => {
    mockReadStatus.mockResolvedValue(wallet);
    render(<SecureChat />);

    expect(
      await within(chatRegion()).findByText(/Connect your Freighter wallet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Checking wallet connection/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Support message')).not.toBeInTheDocument();
    expect(MockSecureChatClient).not.toHaveBeenCalled();
  });

  it('shows the unlocked/fresh state with the new-session banner and wallet address', async () => {
    mockClient.unlock.mockResolvedValue({ kind: 'unlocked', fresh: true });
    render(<SecureChat />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'New encrypted session created for this wallet.',
    );
    expect(mockClient.unlock).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByText(TRUNCATED)).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Support message')).toBeInTheDocument();
  });

  it('shows the unlocked/not-fresh state without the new-session banner', async () => {
    await renderUnlocked();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(TRUNCATED)).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it('shows the different-wallet state when the transcript is locked to another wallet', async () => {
    mockClient.unlock.mockResolvedValue({ kind: 'locked', reason: 'different-wallet' });
    render(<SecureChat />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This transcript belongs to a different wallet.',
    );
    expect(screen.getByRole('button', { name: /Reset session/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Support message')).not.toBeInTheDocument();
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
  });

  it('shows the error state carrying the unlock error message', async () => {
    mockClient.unlock.mockResolvedValue({ kind: 'error', message: 'Key derivation failed' });
    render(<SecureChat />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Key derivation failed');
    expect(screen.queryByLabelText('Support message')).not.toBeInTheDocument();
  });

  it('ignores a readStatus result that resolves after unmount', async () => {
    const wallet = deferred<{ kind: 'connected'; address: string }>();
    mockReadStatus.mockReturnValue(wallet.promise);
    const consoleError = vi.spyOn(console, 'error');
    const { container, unmount } = render(<SecureChat />);

    unmount();
    await act(async () => {
      wallet.resolve({ kind: 'connected', address: ADDRESS });
      await wallet.promise;
    });

    expect(MockSecureChatClient).not.toHaveBeenCalled();
    expect(mockClient.unlock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('ignores an unlock result that resolves after unmount', async () => {
    const unlock = deferred<{ kind: 'unlocked'; fresh: boolean }>();
    mockClient.unlock.mockReturnValue(unlock.promise);
    const consoleError = vi.spyOn(console, 'error');
    const { container, unmount } = render(<SecureChat />);

    await waitFor(() => expect(mockClient.unlock).toHaveBeenCalledWith(ADDRESS));
    unmount();
    await act(async () => {
      unlock.resolve({ kind: 'unlocked', fresh: true });
      await unlock.promise;
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockClient.read).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('makes no client.send call for a blank or whitespace-only draft', async () => {
    const { composer, sendButton } = await renderUnlocked();

    expect(sendButton).toBeDisabled();
    fireEvent.keyDown(composer, { key: 'Enter' });

    fireEvent.change(composer, { target: { value: '   \n  ' } });
    expect(sendButton).toBeDisabled();
    fireEvent.keyDown(composer, { key: 'Enter' });
    fireEvent.submit(composer.closest('form')!);

    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('renders a failed send error, clears it on the next attempt, and re-enables the composer', async () => {
    const retry = deferred<undefined>();
    mockClient.send
      .mockRejectedValueOnce(new Error('Relay unavailable'))
      .mockImplementationOnce(() => retry.promise);
    const { composer, sendButton } = await renderUnlocked();

    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.click(sendButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Relay unavailable');
    await waitFor(() => expect(sendButton).toBeEnabled());
    expect(composer).toHaveValue('hello');

    fireEvent.click(sendButton);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(sendButton).toBeDisabled();

    await act(async () => {
      retry.resolve(undefined);
      await retry.promise;
    });
    await waitFor(() => expect(composer).toHaveValue(''));
    expect(mockClient.send).toHaveBeenCalledTimes(2);
    expect(mockClient.send).toHaveBeenLastCalledWith('hello');
  });

  it('falls back to a generic message when send throws a non-Error', async () => {
    mockClient.send.mockRejectedValueOnce('nope');
    const { composer, sendButton } = await renderUnlocked();

    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.click(sendButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the message');
  });

  it('clears the draft and refetches the transcript after a successful send', async () => {
    mockClient.send.mockImplementation(async () => {
      const sent = message('m-1');
      mockClient.messages = [...mockClient.messages, sent];
      return sent;
    });
    mockClient.read.mockImplementation(async (m: ChatMessage) =>
      m.id === 'm-1' ? 'hello there' : `plain:${m.id}`,
    );
    const { composer, sendButton } = await renderUnlocked();

    fireEvent.change(composer, { target: { value: 'hello there' } });
    fireEvent.click(sendButton);

    await waitFor(() => expect(composer).toHaveValue(''));
    const transcript = screen.getByLabelText('Support conversation');
    expect(await within(transcript).findByText('hello there')).toBeInTheDocument();
    expect(within(transcript).queryByText(/No messages yet/)).not.toBeInTheDocument();
    expect(mockClient.send).toHaveBeenCalledWith('hello there');
    expect(mockClient.read).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }));
  });

  it('sends on Enter but not on Shift+Enter', async () => {
    const { composer } = await renderUnlocked();

    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(mockClient.send).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(mockClient.send).toHaveBeenCalledWith('hello'));
  });

  it('reset calls client.reset(), empties the transcript and re-renders as unlocked/fresh', async () => {
    mockClient.messages = [message('m-1')];
    mockClient.read.mockResolvedValue('old message');
    await renderUnlocked();
    expect(await screen.findByText('old message')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New conversation/ }));

    expect(mockClient.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('old message')).not.toBeInTheDocument());
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'New encrypted session created for this wallet.',
    );
  });

  it('reset from the different-wallet state re-renders as unlocked/fresh', async () => {
    mockClient.unlock.mockResolvedValue({ kind: 'locked', reason: 'different-wallet' });
    render(<SecureChat />);

    fireEvent.click(await screen.findByRole('button', { name: /Reset session/ }));

    expect(mockClient.reset).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'New encrypted session created for this wallet.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Support message')).toBeInTheDocument();
  });

  it('renders "[unreadable]" for a message whose read rejects while siblings render plaintext', async () => {
    mockClient.messages = [message('m-1', 'buyer'), message('m-2'), message('m-3', 'buyer')];
    mockClient.read.mockImplementation(async (m: ChatMessage) => {
      if (m.id === 'm-2') throw new Error('bad auth tag');
      return m.id === 'm-1' ? 'Hi there' : 'Thanks!';
    });
    await renderUnlocked();

    const transcript = screen.getByLabelText('Support conversation');
    expect(await within(transcript).findByText('[unreadable]')).toBeInTheDocument();
    expect(within(transcript).getByText('Hi there')).toBeInTheDocument();
    expect(within(transcript).getByText('Thanks!')).toBeInTheDocument();
    expect(within(transcript).getAllByText(/^Buyer ·/)).toHaveLength(2);
    expect(within(transcript).getAllByText(/^You ·/)).toHaveLength(1);
  });

  it('scrolls the transcript to the bottom whenever the messages change', async () => {
    const scrolls: [string | null, number][] = [];
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 480,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set(this: HTMLDivElement, value: number) {
        scrolls.push([this.getAttribute('aria-label'), value]);
      },
    });
    try {
      mockClient.messages = [message('m-1')];
      mockClient.send.mockImplementation(async () => {
        mockClient.messages = [...mockClient.messages, message('m-2')];
      });
      const { composer, sendButton } = await renderUnlocked();
      expect(await screen.findByText('plain:m-1')).toBeInTheDocument();
      expect(scrolls).toContainEqual(['Support conversation', 480]);

      scrolls.length = 0;
      fireEvent.change(composer, { target: { value: 'next' } });
      fireEvent.click(sendButton);
      expect(await screen.findByText('plain:m-2')).toBeInTheDocument();
      expect(scrolls).toContainEqual(['Support conversation', 480]);
    } finally {
      Reflect.deleteProperty(HTMLDivElement.prototype, 'scrollHeight');
      Reflect.deleteProperty(HTMLDivElement.prototype, 'scrollTop');
    }
  });

  it('hands the client window.localStorage in the browser (the MemoryStorage fallback is SSR-only)', async () => {
    await renderUnlocked();

    expect(MockSecureChatClient).toHaveBeenCalledTimes(1);
    expect(MockSecureChatClient).toHaveBeenCalledWith(window.localStorage);
  });
});
