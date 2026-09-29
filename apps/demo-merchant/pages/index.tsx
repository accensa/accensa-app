import React, { useState } from 'react';
import ProductCard from '../components/ProductCard';
import Cart from '../components/Cart';

const products = [
  {
    id: '1',
    name: 'Developer API Subscription',
    price: 49.99,
    image: 'https://via.placeholder.com/150',
  },
  { id: '2', name: 'Advanced E-book', price: 19.99, image: 'https://via.placeholder.com/150' },
  { id: '3', name: 'Game Credits (1000)', price: 9.99, image: 'https://via.placeholder.com/150' },
];

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
}

interface CartItem extends Product {
  quantity: number;
}

export default function Home() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [network, setNetwork] = useState<'testnet' | 'sandbox'>('testnet');

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white shadow-sm p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Accensa Demo Merchant</h1>
        <div className="flex items-center space-x-4">
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as 'testnet' | 'sandbox')}
            className="border p-2 rounded"
          >
            <option value="testnet">Testnet</option>
            <option value="sandbox">Local Sandbox</option>
          </select>
        </div>
      </header>

      <div className="bg-blue-100 text-blue-800 p-2 text-center text-sm font-medium">
        Simulation Banner: Transactions use{' '}
        {network === 'testnet' ? 'Testnet XLM/USDC' : 'Sandbox Network'}. No real funds are moved.
      </div>

      <main className="container mx-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Product Catalog</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onAdd={() => addToCart(product)} />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Cart</h2>
          <Cart cart={cart} network={network} />
        </div>
      </main>
    </div>
  );
}
