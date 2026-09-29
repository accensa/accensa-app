import React, { useState } from 'react';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartProps {
  cart: CartItem[];
  network: 'testnet' | 'sandbox';
}

export default function Cart({ cart, network }: CartProps) {
  const [discountCode, setDiscountCode] = useState('');

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.08; // 8% tax
  const discount = discountCode === 'DEMO10' ? subtotal * 0.1 : 0;
  const total = subtotal + tax - discount;

  const handleCheckout = () => {
    // Simulate Accensa SDK checkout invocation
    alert(`Invoking @accensa/sdk checkout modal on ${network} for $${total.toFixed(2)}`);
  };

  if (cart.length === 0) {
    return <div className="p-4 border rounded bg-white text-gray-500">Your cart is empty.</div>;
  }

  return (
    <div className="p-4 border rounded bg-white shadow-sm">
      <ul className="mb-4 space-y-2">
        {cart.map((item) => (
          <li key={item.id} className="flex justify-between">
            <span>
              {item.name} x{item.quantity}
            </span>
            <span>${(item.price * item.quantity).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t pt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax (8%)</span>
          <span>${tax.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Discount (10%)</span>
            <span>-${discount.toFixed(2)}</span>
          </div>
        )}
      </div>
      <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      <div className="mt-4 flex space-x-2">
        <input
          type="text"
          placeholder="Discount code (DEMO10)"
          className="border p-2 rounded w-full text-sm"
          value={discountCode}
          onChange={(e) => setDiscountCode(e.target.value)}
        />
      </div>

      <button
        onClick={handleCheckout}
        className="mt-4 w-full bg-green-600 text-white py-3 px-4 rounded font-bold hover:bg-green-700 transition flex items-center justify-center"
      >
        Pay with Accensa
      </button>
    </div>
  );
}
