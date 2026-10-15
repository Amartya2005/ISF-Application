import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { formatIst } from "@sj/client";
import type { NotificationItem } from "@sj/contracts";
import { Card, H2, Loading, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

export default function Notifications() {
  const { api } = useSession();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.myNotifications().then(setItems, (e) => setError(messageOf(e))); }, [api]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!items) return <Screen><Loading /></Screen>;
  if (items.length === 0) return <Screen><P muted>No messages yet.</P></Screen>;
  return (
    <Screen>
      {items.map((n) => (
        <Card key={n.id}>
          <H2>{n.title}</H2>
          <P>{n.body}</P>
          <P muted small>{formatIst(n.createdAt)} IST</P>
        </Card>
      ))}
    </Screen>
  );
}
