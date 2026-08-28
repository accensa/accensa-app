import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './error-boundary';

/** Render whatever `ErrorBoundary` produces for the given props + state. */
function renderBoundary(props: React.ComponentProps<typeof ErrorBoundary>, error: Error | null) {
  const instance = new ErrorBoundary(props);
  instance.state = { error };
  return renderToString(<>{instance.render()}</>);
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing has thrown', () => {
    const html = renderToString(
      <ErrorBoundary label="widget">
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(html).toContain('all good');
  });

  it('getDerivedStateFromError carries the error into state', () => {
    const err = new Error('x');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('shows the default fallback, naming the section, once an error is set', () => {
    const html = renderBoundary({ label: 'revenue chart', children: null }, new Error('kaboom'));
    expect(html).toContain('The revenue chart could not be shown.');
    expect(html).toContain('the page is unaffected');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Try again');
  });

  it('falls back to a generic message with no label', () => {
    const html = renderBoundary({ children: null }, new Error('kaboom'));
    expect(html).toContain('This section could not be shown.');
  });

  it('uses a custom fallback render prop when given one', () => {
    const html = renderBoundary(
      { children: null, fallback: (error) => <span>custom: {error.message}</span> },
      new Error('kaboom'),
    );
    expect(html).toContain('custom:');
    expect(html).toContain('kaboom');
  });
});
