import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { formatIst } from "@sj/client";
import type { MyApplicationsResponse } from "@sj/contracts";
import { Badge, Button, Card, H1, H2, Loading, Notice, P, Screen } from "../components/ui";
import { STATUS_LABEL, STATUS_TONE } from "../lib/labels";
import { messageOf, useSession } from "../lib/session";

/** One card per year: 2026 and 2027 applications have separate statuses (FR-REG-05). Drafts are never shown. */
export default function Status() {
  const { api } = useSession();
  const [data, setData] = useState<MyApplicationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    api.myApplications().then(setData, (e) => setError(messageOf(e)));
  }, [api]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!data) return <Screen><Loading /></Screen>;
  if (!data.startup || data.applications.length === 0) {
    return (
      <Screen>
        <P>No application is linked to this account.</P>
        <Button title="Register a startup" onPress={() => router.push("/register")} />
      </Screen>
    );
  }
  return (
    <Screen>
      <H1>{data.startup.name}</H1>
      <P muted>Each year has its own application and its own result.</P>
      {data.applications.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <H2>Startup Jathara {a.edition}</H2>
            <Badge text={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
          </View>
          <P muted small>Submitted {formatIst(a.submittedAt)} IST{a.decidedAt ? ` · Decision released ${formatIst(a.decidedAt)} IST` : ""}</P>
        </Card>
      ))}
    </Screen>
  );
}
