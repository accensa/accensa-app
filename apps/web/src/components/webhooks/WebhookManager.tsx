"use client";

import { useState, useEffect } from "react";

/**
 * Webhook Management UI (#147).
 *
 * Allows merchants to create, list, test, and delete webhook endpoints
 * for receiving real-time payment notifications.
 */

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

export default function WebhookManager() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("payment.completed,payment.failed");

  useEffect(() => {
    fetchWebhooks();
  }, []);

  async function fetchWebhooks() {
    try {
      const res = await fetch("/api/webhooks");
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks ?? []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }

  async function createWebhook() {
    if (!newUrl) return;
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newUrl,
          events: newEvents.split(",").map((e) => e.trim()),
        }),
      });
      if (res.ok) {
        setNewUrl("");
        setShowCreate(false);
        fetchWebhooks();
      }
    } catch {
      // Silent fail
    }
  }

  async function deleteWebhook(id: string) {
    try {
      await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      fetchWebhooks();
    } catch {
      // Silent fail
    }
  }

  async function toggleWebhook(id: string, active: boolean) {
    try {
      await fetch(`/api/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      fetchWebhooks();
    } catch {
      // Silent fail
    }
  }

  async function testWebhook(id: string) {
    try {
      await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      alert("Test webhook sent!");
    } catch {
      alert("Failed to send test webhook");
    }
  }

  if (loading) {
    return <div className="p-4 text-gray-500">Loading webhooks...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Webhooks</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
        >
          {showCreate ? "Cancel" : "Add Webhook"}
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6 border">
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">Endpoint URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">Events (comma-separated)</label>
            <input
              type="text"
              value={newEvents}
              onChange={(e) => setNewEvents(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={createWebhook}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm"
          >
            Create
          </button>
        </div>
      )}

      {webhooks.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No webhooks configured. Add one to receive real-time payment notifications.
        </p>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="border rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="font-mono text-sm">{wh.url}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Events: {wh.events.join(", ")}
                </p>
                {wh.lastTriggeredAt && (
                  <p className="text-xs text-gray-400">
                    Last triggered: {new Date(wh.lastTriggeredAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => testWebhook(wh.id)}
                  className="text-blue-600 hover:underline text-sm"
                >
                  Test
                </button>
                <button
                  onClick={() => toggleWebhook(wh.id, wh.active)}
                  className={`text-sm ${wh.active ? "text-yellow-600" : "text-green-600"} hover:underline`}
                >
                  {wh.active ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => deleteWebhook(wh.id)}
                  className="text-red-600 hover:underline text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
