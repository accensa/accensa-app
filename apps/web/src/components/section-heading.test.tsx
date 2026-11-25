// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SectionHeading } from './section-heading';

describe('SectionHeading', () => {
  it('renders the eyebrow only when one is passed', () => {
    const { container } = render(<SectionHeading>Bare title</SectionHeading>);
    const heading = screen.getByRole('heading', { level: 2 });

    expect(heading.textContent).toBe('Bare title');
    expect(container.querySelector('p')).toBeNull();

    render(<SectionHeading eyebrow="Payments">Decorated title</SectionHeading>);
    expect(screen.getByText('Payments', { exact: true })).toBeInTheDocument();
  });

  it('keeps the heading exactly equal to children when tail is absent', () => {
    render(<SectionHeading eyebrow="Payments">Ship payments</SectionHeading>);
    const heading = screen.getByRole('heading', { level: 2 });

    expect(heading.textContent).toBe('Ship payments');
    expect(heading.querySelector('span')).toBeNull();
  });

  it('renders children, one space, then the tail in an italic span', () => {
    render(
      <SectionHeading eyebrow="Payments" tail="effortless">
        Make it
      </SectionHeading>,
    );
    const heading = screen.getByRole('heading', { level: 2 });

    expect(heading.textContent).toBe('Make it effortless');
    expect(heading.firstChild?.textContent).toBe('Make it');

    const tail = within(heading).getByText('effortless');
    expect(tail.tagName).toBe('SPAN');
    expect(tail).toHaveClass('italic');
  });

  it('forwards className to the wrapper', () => {
    const { container } = render(
      <SectionHeading className="section-spacing">Title</SectionHeading>,
    );

    expect(container.firstElementChild).toHaveClass('section-spacing');
  });
});
