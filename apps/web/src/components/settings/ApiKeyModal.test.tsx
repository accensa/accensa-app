// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyModal } from './ApiKeyModal';

describe('ApiKeyModal', () => {
  const onCloseMock = vi.fn();
  const onGenerateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Modal Visibility and Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<ApiKeyModal isOpen={false} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      expect(screen.queryByRole('heading', { name: 'Generate API Key' })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('e.g. Production Server')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument();
    });

    it('renders modal elements and default initial state when isOpen is true', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      expect(screen.getByRole('heading', { name: 'Generate API Key' })).toBeInTheDocument();
      expect(screen.getByText('Key Name')).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveValue('');

      const readCheckbox = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });
      const adminCheckbox = screen.getByRole('checkbox', {
        name: /Admin \(Manage settings and keys\)/i,
      });

      expect(readCheckbox).toBeInTheDocument();
      expect(readCheckbox).toBeChecked();
      expect(writeCheckbox).toBeInTheDocument();
      expect(writeCheckbox).not.toBeChecked();
      expect(adminCheckbox).toBeInTheDocument();
      expect(adminCheckbox).not.toBeChecked();

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const generateButton = screen.getByRole('button', { name: 'Generate' });

      expect(cancelButton).toBeInTheDocument();
      expect(generateButton).toBeInTheDocument();
      // Generate button should be disabled initially because name is empty
      expect(generateButton).toBeDisabled();
    });

    it('calls onClose when Cancel button is clicked', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(onCloseMock).toHaveBeenCalledTimes(1);
      expect(onGenerateMock).not.toHaveBeenCalled();
    });
  });

  describe('Permission Toggles', () => {
    it('allows toggling individual permissions on and off', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const readCheckbox = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });
      const adminCheckbox = screen.getByRole('checkbox', {
        name: /Admin \(Manage settings and keys\)/i,
      });

      // Initially read is checked, write and admin are unchecked
      expect(readCheckbox).toBeChecked();
      expect(writeCheckbox).not.toBeChecked();
      expect(adminCheckbox).not.toBeChecked();

      // Toggle read off
      fireEvent.click(readCheckbox);
      expect(readCheckbox).not.toBeChecked();

      // Toggle write on
      fireEvent.click(writeCheckbox);
      expect(writeCheckbox).toBeChecked();

      // Toggle admin on
      fireEvent.click(adminCheckbox);
      expect(adminCheckbox).toBeChecked();

      // Toggle write off
      fireEvent.click(writeCheckbox);
      expect(writeCheckbox).not.toBeChecked();
      expect(adminCheckbox).toBeChecked();
    });

    it('supports selecting multiple permissions simultaneously', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const readCheckbox = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });
      const adminCheckbox = screen.getByRole('checkbox', {
        name: /Admin \(Manage settings and keys\)/i,
      });

      // Enable all three
      fireEvent.click(writeCheckbox);
      fireEvent.click(adminCheckbox);

      expect(readCheckbox).toBeChecked();
      expect(writeCheckbox).toBeChecked();
      expect(adminCheckbox).toBeChecked();

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      fireEvent.change(nameInput, { target: { value: 'Super Key' } });

      const generateButton = screen.getByRole('button', { name: 'Generate' });
      fireEvent.click(generateButton);

      expect(onGenerateMock).toHaveBeenCalledWith('Super Key', ['read', 'write', 'admin']);
    });

    it('submits updated permissions when modified by the user', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const readCheckbox = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });

      // Uncheck read, check write
      fireEvent.click(readCheckbox);
      fireEvent.click(writeCheckbox);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      fireEvent.change(nameInput, { target: { value: 'Write Only Key' } });

      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      expect(onGenerateMock).toHaveBeenCalledWith('Write Only Key', ['write']);
    });

    it('resets form state back to initial defaults on reopen after unmount', () => {
      const { rerender } = render(
        <ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />,
      );

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });

      fireEvent.change(nameInput, { target: { value: 'Temporary Name' } });
      fireEvent.click(writeCheckbox);

      // Close modal
      rerender(<ApiKeyModal isOpen={false} onClose={onCloseMock} onGenerate={onGenerateMock} />);
      expect(screen.queryByPlaceholderText('e.g. Production Server')).not.toBeInTheDocument();

      // Reopen modal (new instance)
      rerender(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const reopenedInput = screen.getByPlaceholderText('e.g. Production Server');
      const reopenedRead = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const reopenedWrite = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });

      expect(reopenedInput).toHaveValue('');
      expect(reopenedRead).toBeChecked();
      expect(reopenedWrite).not.toBeChecked();
    });
  });

  describe('Submit Guard and Validation', () => {
    it('disables submit button when key name is empty', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const generateButton = screen.getByRole('button', { name: 'Generate' });
      expect(generateButton).toBeDisabled();

      fireEvent.click(generateButton);
      expect(onGenerateMock).not.toHaveBeenCalled();
    });

    it('disables submit button when key name contains only whitespace', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const generateButton = screen.getByRole('button', { name: 'Generate' });

      fireEvent.change(nameInput, { target: { value: '     ' } });

      expect(generateButton).toBeDisabled();

      fireEvent.click(generateButton);
      expect(onGenerateMock).not.toHaveBeenCalled();
    });

    it('disables submit button when no permissions are selected even if name is valid', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const readCheckbox = screen.getByRole('checkbox', {
        name: /Read \(View transactions and balances\)/i,
      });
      const generateButton = screen.getByRole('button', { name: 'Generate' });

      fireEvent.change(nameInput, { target: { value: 'Valid Name' } });
      expect(generateButton).toBeEnabled();

      // Uncheck read so permissions list becomes empty
      fireEvent.click(readCheckbox);

      expect(generateButton).toBeDisabled();

      fireEvent.click(generateButton);
      expect(onGenerateMock).not.toHaveBeenCalled();
    });

    it('prevents submission when form onSubmit event is fired directly with invalid input', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      fireEvent.change(nameInput, { target: { value: '   ' } });

      const form = nameInput.closest('form')!;
      fireEvent.submit(form);

      expect(onGenerateMock).not.toHaveBeenCalled();
    });

    it('enables submit button and invokes onGenerate with trimmed name and permissions on valid submission', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const generateButton = screen.getByRole('button', { name: 'Generate' });

      fireEvent.change(nameInput, { target: { value: '   Production API Key   ' } });
      expect(generateButton).toBeEnabled();

      fireEvent.click(generateButton);

      expect(onGenerateMock).toHaveBeenCalledTimes(1);
      expect(onGenerateMock).toHaveBeenCalledWith('Production API Key', ['read']);
    });

    it('resets name and permissions back to defaults after successful submission', () => {
      render(<ApiKeyModal isOpen={true} onClose={onCloseMock} onGenerate={onGenerateMock} />);

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const writeCheckbox = screen.getByRole('checkbox', {
        name: /Write \(Create escrows and invoices\)/i,
      });
      const generateButton = screen.getByRole('button', { name: 'Generate' });

      fireEvent.change(nameInput, { target: { value: 'Temporary Key' } });
      fireEvent.click(writeCheckbox);

      fireEvent.click(generateButton);

      expect(onGenerateMock).toHaveBeenCalledWith('Temporary Key', ['read', 'write']);

      // After submit: name is cleared, permissions reset to ['read'], generate button disabled
      expect(nameInput).toHaveValue('');
      expect(writeCheckbox).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: /Read/i })).toBeChecked();
      expect(generateButton).toBeDisabled();
    });

    it('integrates with async API mutation handler and verifies payload', async () => {
      const mockApiMutation = vi.fn().mockResolvedValue({ id: 'key_abc', secret: 'acc_sec_123' });

      render(
        <ApiKeyModal
          isOpen={true}
          onClose={onCloseMock}
          onGenerate={(name, permissions) => {
            void mockApiMutation({ name, permissions });
          }}
        />,
      );

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      const adminCheckbox = screen.getByRole('checkbox', {
        name: /Admin \(Manage settings and keys\)/i,
      });

      fireEvent.change(nameInput, { target: { value: 'CI Bot' } });
      fireEvent.click(adminCheckbox);

      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      expect(mockApiMutation).toHaveBeenCalledTimes(1);
      expect(mockApiMutation).toHaveBeenCalledWith({
        name: 'CI Bot',
        permissions: ['read', 'admin'],
      });
    });

    it('handles API mutation failure gracefully without falsely triggering onClose', () => {
      const failingMutation = vi.fn().mockImplementation(() => {
        throw new Error('API server error');
      });

      render(
        <ApiKeyModal
          isOpen={true}
          onClose={onCloseMock}
          onGenerate={(name, permissions) => {
            try {
              failingMutation({ name, permissions });
              onCloseMock();
            } catch {
              // Retain modal open on error
            }
          }}
        />,
      );

      const nameInput = screen.getByPlaceholderText('e.g. Production Server');
      fireEvent.change(nameInput, { target: { value: 'Fail Key' } });

      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      expect(failingMutation).toHaveBeenCalledTimes(1);
      expect(onCloseMock).not.toHaveBeenCalled();
    });
  });
});
