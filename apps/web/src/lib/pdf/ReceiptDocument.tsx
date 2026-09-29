import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
    borderBottom: '1px solid #eee',
    paddingBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  merchantInfo: {
    textAlign: 'right',
    color: '#666',
  },
  detailsSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  label: {
    color: '#666',
    marginBottom: 4,
  },
  value: {
    fontWeight: 'bold',
    marginBottom: 10,
  },
  table: {
    width: '100%',
    marginBottom: 40,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottom: '1px solid #000',
    paddingBottom: 8,
    marginBottom: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1px solid #eee',
    paddingVertical: 8,
  },
  colDesc: { width: '60%' },
  colQty: { width: '15%', textAlign: 'center' },
  colPrice: { width: '25%', textAlign: 'right' },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTop: '2px solid #000',
    paddingTop: 10,
  },
  totalLabel: {
    width: '60%',
    textAlign: 'right',
    paddingRight: 20,
    fontWeight: 'bold',
  },
  totalValue: {
    width: '25%',
    textAlign: 'right',
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '1px solid #eee',
    paddingTop: 20,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrImage: {
    width: 80,
    height: 80,
    marginBottom: 8,
  },
  verificationText: {
    fontSize: 8,
    color: '#666',
    textAlign: 'center',
    width: 150,
  },
});

export interface ReceiptData {
  receiptId: string;
  date: string;
  merchantName: string;
  merchantAddress: string;
  customerName?: string;
  items: Array<{ description: string; quantity: number; price: number }>;
  total: number;
  qrCodeDataUrl: string;
}

export const ReceiptDocument: React.FC<{ data: ReceiptData }> = ({ data }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>RECEIPT</Text>
          <Text style={styles.label}>No. {data.receiptId}</Text>
        </View>
        <View style={styles.merchantInfo}>
          <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>{data.merchantName}</Text>
          <Text>{data.merchantAddress}</Text>
        </View>
      </View>

      <View style={styles.detailsSection}>
        <View>
          <Text style={styles.label}>Date of Issue</Text>
          <Text style={styles.value}>{data.date}</Text>
        </View>
        <View>
          <Text style={styles.label}>Billed To</Text>
          <Text style={styles.value}>{data.customerName || 'Walk-in Customer'}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colPrice}>Amount</Text>
        </View>
        {data.items.map((item, i) => (
          <View style={styles.tableRow} key={i}>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colQty}>{item.quantity}</Text>
            <Text style={styles.colPrice}>${item.price.toFixed(2)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totalSection}>
        <Text style={styles.totalLabel}>Total Due:</Text>
        <Text style={styles.totalValue}>${data.total.toFixed(2)}</Text>
      </View>

      <View style={styles.footer}>
        <View>
          <Text style={{ fontSize: 10, color: '#666' }}>Thank you for your business!</Text>
        </View>
        <View style={styles.qrContainer}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={data.qrCodeDataUrl} style={styles.qrImage} />
          <Text style={styles.verificationText}>
            Scan to verify cryptographic proof on Stellar Expert
          </Text>
        </View>
      </View>
    </Page>
  </Document>
);
