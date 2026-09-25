- closes #378

### Changes Made:
- **Performance**: Audited `receipt-anchor.test.ts`, stripped out redundant data mocking iterations, and heavily optimized the object allocations for a significant bump in test execution speed.
