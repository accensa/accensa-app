// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationPreferences } from './NotificationPreferences';

const { mockRequestNotificationPermission, mockPlayAudioAlert } = vi.hoisted(() => ({
  mockRequestNotificationPermission: vi.fn(),
  mockPlayAudioAlert: vi.fn(),
}));

vi.mock('../../lib/notifications/desktopPush', () => ({
  requestNotificationPermission: mockRequestNotificationPermission,
  playAudioAlert: mockPlayAudioAlert,
}));

describe('NotificationPreferences', () => {
  const originalNotification = Reflect.get(window, 'Notification');

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, 'Notification');
  });

  afterEach(() => {
    if (originalNotification === undefined) {
      Reflect.deleteProperty(window, 'Notification');
    } else {
      Reflect.set(window, 'Notification', originalNotification);
    }
    vi.restoreAllMocks();
  });

  it('renders default status and displays the enable button when window.Notification is absent', () => {
    Reflect.deleteProperty(window, 'Notification');

    render(<NotificationPreferences />);

    expect(screen.getByText('default')).toBeDefined();
    expect(screen.getByRole('button', { name: /enable push notifications/i })).toBeDefined();
  });

  it('does not display the enable button when Notification.permission is preset to granted', () => {
    Reflect.set(window, 'Notification', {
      permission: 'granted',
      requestPermission: vi.fn(),
    });

    render(<NotificationPreferences />);

    expect(screen.getByText('granted')).toBeDefined();
    expect(screen.queryByRole('button', { name: /enable push notifications/i })).toBeNull();
  });

  it('updates status and keeps the enable button when permission resolves to denied, but removes it when granted', async () => {
    Reflect.set(window, 'Notification', {
      permission: 'default',
      requestPermission: vi.fn(),
    });

    mockRequestNotificationPermission.mockResolvedValueOnce('denied');

    render(<NotificationPreferences />);

    const enableButton = screen.getByRole('button', { name: /enable push notifications/i });
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByText('denied')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /enable push notifications/i })).toBeDefined();

    mockRequestNotificationPermission.mockResolvedValueOnce('granted');
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByText('granted')).toBeDefined();
      expect(screen.queryByRole('button', { name: /enable push notifications/i })).toBeNull();
    });
  });

  it('unmounts tone controls on sound toggle uncheck and remounts with retained frequency on re-check', () => {
    render(<NotificationPreferences />);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '650' } });
    expect(screen.getByText('650 Hz')).toBeDefined();

    const soundCheckbox = screen.getByRole('checkbox', {
      name: /enable sound for incoming payments/i,
    });
    expect(soundCheckbox).toBeChecked();

    // Uncheck sound toggle
    fireEvent.click(soundCheckbox);

    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText('650 Hz')).toBeNull();
    expect(screen.queryByRole('button', { name: /test audio tone/i })).toBeNull();

    // Re-check sound toggle
    fireEvent.click(soundCheckbox);

    const remountedSlider = screen.getByRole('slider') as HTMLInputElement;
    expect(remountedSlider).toBeDefined();
    expect(remountedSlider.value).toBe('650');
    expect(screen.getByText('650 Hz')).toBeDefined();
    expect(screen.getByRole('button', { name: /test audio tone/i })).toBeDefined();
  });

  it('calls playAudioAlert with 800 when slider is moved to 800 and test audio button is clicked, and asserts bounds', () => {
    render(<NotificationPreferences />);

    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('min')).toBe('200');
    expect(slider.getAttribute('max')).toBe('1000');

    fireEvent.change(slider, { target: { value: '800' } });
    expect(screen.getByText('800 Hz')).toBeDefined();

    const testToneButton = screen.getByRole('button', { name: /test audio tone/i });
    fireEvent.click(testToneButton);

    expect(mockPlayAudioAlert).toHaveBeenCalledWith(800);
  });
});
