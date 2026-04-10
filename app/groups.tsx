import { Session } from "@supabase/supabase-js";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Group = {
  id: string;
  name: string;
  owner_id: string;
};

type Profile = {
  id: string;
  email: string;
};

type GroupMemberRow = {
  id: string;
  user_id: string;
};

type MemberWithEmail = {
  id: string;
  user_id: string;
  email: string;
  isOwner: boolean;
};

export default function GroupsScreen() {
  const [session, setSession] = useState<Session | null>(null);

  const [ownedGroups, setOwnedGroups] = useState<Group[]>([]);
  const [memberGroups, setMemberGroups] = useState<Group[]>([]);

  const [groupName, setGroupName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<MemberWithEmail[]>([]);

  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [groupMessage, setGroupMessage] = useState("");
  const [groupMessageType, setGroupMessageType] = useState<
    "error" | "success" | ""
  >("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchAllGroups();
    } else {
      setOwnedGroups([]);
      setMemberGroups([]);
    }
  }, [session]);

  async function fetchAllGroups() {
    if (!session?.user) return;

    setLoading(true);

    const { data: ownedData, error: ownedError } = await supabase
      .from("groups")
      .select("*")
      .eq("owner_id", session.user.id)
      .order("created_at", { ascending: false });

    if (ownedError) {
      setLoading(false);
      Alert.alert("Virhe", `Ryhmien haku epäonnistui: ${ownedError.message}`);
      return;
    }

    const owned = (ownedData ?? []) as Group[];
    setOwnedGroups(owned);

    const { data: membershipRows, error: membershipError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", session.user.id);

    if (membershipError) {
      setLoading(false);
      Alert.alert(
        "Virhe",
        `Jäsenyyksien haku epäonnistui: ${membershipError.message}`,
      );
      return;
    }

    const membershipGroupIds = Array.from(
      new Set((membershipRows ?? []).map((row: any) => row.group_id as string)),
    );

    const ownedIds = new Set(owned.map((group) => group.id));
    const memberOnlyIds = membershipGroupIds.filter((id) => !ownedIds.has(id));

    if (memberOnlyIds.length === 0) {
      setMemberGroups([]);
      setLoading(false);
      return;
    }

    const { data: memberGroupData, error: memberGroupError } = await supabase
      .from("groups")
      .select("*")
      .in("id", memberOnlyIds)
      .order("created_at", { ascending: false });

    if (memberGroupError) {
      setLoading(false);
      Alert.alert(
        "Virhe",
        `Ryhmien haku epäonnistui: ${memberGroupError.message}`,
      );
      return;
    }

    setMemberGroups((memberGroupData ?? []) as Group[]);
    setLoading(false);
  }

  async function createGroup() {
    setGroupMessage("");
    setGroupMessageType("");

    if (!groupName.trim()) {
      setGroupMessageType("error");
      setGroupMessage("Ryhmän nimi ei voi olla tyhjä.");
      return;
    }

    if (!session?.user) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("groups")
      .insert({
        name: groupName.trim(),
        owner_id: session.user.id,
      })
      .select()
      .single();

    if (error) {
      setLoading(false);
      setGroupMessageType("error");
      setGroupMessage(`Ryhmän luonti epäonnistui: ${error.message}`);
      return;
    }

    setGroupName("");
    await fetchAllGroups();
    setLoading(false);
    setGroupMessageType("success");
    setGroupMessage("Ryhmä luotu.");
  }

  async function openGroupModal(group: Group) {
    setSelectedGroup(group);
    setMemberEmail("");
    setModalOpen(true);
    await fetchMembers(group);
  }

  async function fetchMembers(group: Group) {
    const { data: memberRows, error: memberRowsError } = await supabase
      .from("group_members")
      .select("id, user_id")
      .eq("group_id", group.id);

    if (memberRowsError) {
      Alert.alert(
        "Virhe",
        `Jäsenten haku epäonnistui: ${memberRowsError.message}`,
      );
      return;
    }

    const rows = (memberRows ?? []) as GroupMemberRow[];

    if (rows.length === 0) {
      setMembers([]);
      return;
    }

    const userIds = rows.map((row) => row.user_id);

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    if (profilesError) {
      Alert.alert(
        "Virhe",
        `Profiilien haku epäonnistui: ${profilesError.message}`,
      );
      return;
    }

    const profileMap = new Map(
      ((profilesData ?? []) as Profile[]).map((profile) => [
        profile.id,
        profile.email,
      ]),
    );

    const mapped: MemberWithEmail[] = rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      email: profileMap.get(row.user_id) ?? "Tuntematon käyttäjä",
      isOwner: row.user_id === group.owner_id,
    }));

    setMembers(mapped);
  }

  async function addMemberByEmail() {
    if (!selectedGroup) {
      Alert.alert("Virhe", "Valitse ensin ryhmä.");
      return;
    }

    const normalizedEmail = memberEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      Alert.alert("Virhe", "Syötä käyttäjän sähköposti.");
      return;
    }

    setLoading(true);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (profileError) {
      setLoading(false);
      Alert.alert(
        "Virhe",
        `Käyttäjän haku epäonnistui: ${profileError.message}`,
      );
      return;
    }

    if (!profile) {
      setLoading(false);
      Alert.alert(
        "Käyttäjää ei löytynyt",
        "Varmista, että käyttäjä on jo rekisteröitynyt sovellukseen.",
      );
      return;
    }

    const alreadyMember = members.some((m) => m.user_id === profile.id);

    if (alreadyMember) {
      setLoading(false);
      Alert.alert("Virhe", "Käyttäjä on jo ryhmässä.");
      return;
    }

    setMemberEmail("");
    await fetchMembers(selectedGroup);
    await fetchAllGroups();
    setLoading(false);
    Alert.alert("Onnistui", `${profile.email} lisättiin ryhmään.`);
  }

  async function removeMember(member: MemberWithEmail) {
    if (!selectedGroup) return;

    if (member.isOwner) {
      Alert.alert("Ei sallittu", "Ryhmän omistajaa ei voi poistaa jäsenistä.");
      return;
    }

    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", selectedGroup.id)
      .eq("user_id", member.user_id);

    if (error) {
      Alert.alert("Virhe", `Jäsenen poisto epäonnistui: ${error.message}`);
      return;
    }

    await fetchMembers(selectedGroup);
    await fetchAllGroups();
  }

  async function leaveGroup(group: Group) {
    if (!session?.user) return;

    if (group.owner_id === session.user.id) {
      Alert.alert(
        "Ei sallittu",
        "Ryhmän omistaja ei voi poistua ryhmästä. Poista ryhmä kokonaan, jos et enää tarvitse sitä.",
      );
      return;
    }

    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", session.user.id);

    if (error) {
      Alert.alert(
        "Virhe",
        `Ryhmästä poistuminen epäonnistui: ${error.message}`,
      );
      return;
    }

    await fetchAllGroups();
    Alert.alert("Onnistui", `Poistuit ryhmästä ${group.name}.`);
  }

  async function deleteGroup(group: Group) {
    const { error } = await supabase.from("groups").delete().eq("id", group.id);

    if (error) {
      Alert.alert("Virhe", `Ryhmän poisto epäonnistui: ${error.message}`);
      return;
    }

    if (selectedGroup?.id === group.id) {
      setModalOpen(false);
      setSelectedGroup(null);
      setMembers([]);
    }

    await fetchAllGroups();
    Alert.alert("Onnistui", `Ryhmä "${group.name}" poistettiin.`);
  }

  function renderGroupCard(group: Group, isOwner: boolean) {
    return (
      <View key={group.id} style={styles.groupItem}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupName}>{group.name}</Text>

          <View style={styles.badgeRow}>
            <View
              style={[
                styles.roleBadge,
                isOwner ? styles.ownerBadge : styles.memberBadge,
              ]}
            >
              <Text style={styles.roleBadgeText}>
                {isOwner ? "Omistaja" : "Jäsen"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.groupActions}>
          <Pressable
            style={styles.smallMutedButton}
            onPress={() => openGroupModal(group)}
          >
            <Text style={styles.smallMutedButtonText}>Hallinnoi</Text>
          </Pressable>

          {!isOwner && (
            <Pressable
              style={styles.smallDangerButton}
              onPress={() => leaveGroup(group)}
            >
              <Text style={styles.smallDangerButtonText}>Poistu</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }
  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.title}>Ryhmät</Text>
            <Text style={styles.emptyText}>
              Kirjaudu ensin sisään nähdäksesi ryhmät.
            </Text>

            <Pressable
              onPress={() => router.replace("/")}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Takaisin</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const isSelectedGroupOwner =
    !!selectedGroup && selectedGroup.owner_id === session.user.id;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.contentInner}>
          <View style={styles.header}>
            <Pressable
              onPress={() => router.replace("/")}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>←</Text>
            </Pressable>

            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Ryhmät</Text>
              <Text style={styles.headerTagline}>
                Hallitse metsästysseuran ryhmiä ja jäseniä
              </Text>
              <Text style={styles.subtitleSmall}>{session.user.email}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Luo uusi ryhmä</Text>

            <TextInput
              style={styles.input}
              placeholder="Ryhmän nimi"
              placeholderTextColor="#94a3b8"
              value={groupName}
              onChangeText={setGroupName}
            />

            {groupMessage ? (
              <Text
                style={[
                  styles.messageText,
                  groupMessageType === "error"
                    ? styles.errorText
                    : styles.successText,
                ]}
              >
                {groupMessage}
              </Text>
            ) : null}

            <Pressable
              style={styles.primaryButton}
              onPress={createGroup}
              disabled={loading}
            >
              <Text style={styles.primaryButtonText}>
                {loading ? "Luodaan..." : "Luo ryhmä"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Omat ryhmät</Text>

            {ownedGroups.length === 0 ? (
              <Text style={styles.emptyText}>Et ole vielä luonut ryhmiä.</Text>
            ) : (
              ownedGroups.map((group) => renderGroupCard(group, true))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ryhmät, joihin kuulut</Text>

            {memberGroups.length === 0 ? (
              <Text style={styles.emptyText}>
                Et kuulu vielä muihin ryhmiin.
              </Text>
            ) : (
              memberGroups.map((group) => renderGroupCard(group, false))
            )}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {selectedGroup?.name ?? "Ryhmä"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {isSelectedGroupOwner ? "Jäsenhallinta" : "Ryhmän tiedot"}
                </Text>
              </View>

              <Pressable
                onPress={() => setModalOpen(false)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>✕</Text>
              </Pressable>
            </View>

            {isSelectedGroupOwner && (
              <>
                <Text style={styles.sectionTitle}>Lisää jäsen</Text>

                <TextInput
                  style={styles.input}
                  placeholder="jäsen@email.com"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={memberEmail}
                  onChangeText={setMemberEmail}
                />

                <Pressable
                  style={styles.primaryButton}
                  onPress={addMemberByEmail}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>
                    {loading ? "Lisätään..." : "Lisää jäsen"}
                  </Text>
                </Pressable>
              </>
            )}

            <Text
              style={[
                styles.sectionTitle,
                { marginTop: isSelectedGroupOwner ? 20 : 0 },
              ]}
            >
              {isSelectedGroupOwner ? "Poista jäsen" : "Ryhmän jäsenet"}
            </Text>

            {members.length === 0 ? (
              <Text style={styles.emptyText}>
                Ryhmällä ei ole vielä jäseniä.
              </Text>
            ) : (
              members.map((member) => (
                <View key={member.id} style={styles.memberRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                    {member.isOwner && (
                      <Text style={styles.memberRole}>Omistaja</Text>
                    )}
                  </View>

                  {isSelectedGroupOwner && !member.isOwner && (
                    <Pressable
                      style={styles.smallDangerButton}
                      onPress={() => removeMember(member)}
                    >
                      <Text style={styles.smallDangerButtonText}>Poista</Text>
                    </Pressable>
                  )}
                </View>
              ))
            )}

            <View style={styles.modalFooter}>
              {selectedGroup && !isSelectedGroupOwner && (
                <Pressable
                  style={styles.smallDangerButton}
                  onPress={() => leaveGroup(selectedGroup)}
                >
                  <Text style={styles.smallDangerButtonText}>
                    Poistu ryhmästä
                  </Text>
                </Pressable>
              )}

              {selectedGroup && isSelectedGroupOwner && (
                <Pressable
                  style={styles.deleteGroupButton}
                  onPress={() => deleteGroup(selectedGroup)}
                >
                  <Text style={styles.smallDangerButtonText}>Poista ryhmä</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101712",
  },
  content: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 80,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    color: "#f4f1e8",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitleSmall: {
    color: "#c8d0c8",
    fontSize: 14,
  },
  card: {
    backgroundColor: "#1b241d",
    padding: 18,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  sectionTitle: {
    color: "#f4f1e8",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#313d34",
    color: "#f4f1e8",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#445146",
  },
  primaryButton: {
    backgroundColor: "#a35f1c",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fffaf2",
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#313d34",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#445146",
  },
  secondaryButtonText: {
    color: "#f4f1e8",
    fontWeight: "600",
  },
  groupItem: {
    backgroundColor: "#313d34",
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#445146",
  },
  groupName: {
    color: "#fffaf2",
    fontWeight: "600",
    fontSize: 16,
    marginBottom: 4,
  },
  groupActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  smallMutedButton: {
    backgroundColor: "#4d5b51",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallMutedButtonText: {
    color: "#fffaf2",
    fontWeight: "700",
  },
  emptyText: {
    color: "#c8d0c8",
    lineHeight: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(6, 10, 8, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 680,
    backgroundColor: "#1b241d",
    borderRadius: 20,
    padding: 20,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
  },
  modalTitle: {
    color: "#f4f1e8",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalSubtitle: {
    color: "#c8d0c8",
    fontSize: 14,
  },
  memberRow: {
    backgroundColor: "#313d34",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#445146",
  },
  memberEmail: {
    color: "#fffaf2",
    flex: 1,
  },
  memberRole: {
    color: "#d8a15f",
    fontSize: 12,
    marginTop: 4,
  },
  smallDangerButton: {
    backgroundColor: "#8b2f2f",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallDangerButtonText: {
    color: "#fffaf2",
    fontWeight: "700",
  },
  deleteGroupButton: {
    backgroundColor: "#7a2626",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  modalFooter: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  },
  messageText: {
    marginBottom: 12,
    lineHeight: 21,
  },
  errorText: {
    color: "#f1a1a1",
  },
  successText: {
    color: "#9dd6aa",
  },
  scroll: {
    flex: 1,
  },
  contentInner: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  badgeRow: {
    flexDirection: "row",
    marginTop: 6,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ownerBadge: {
    backgroundColor: "#8f5319",
  },
  memberBadge: {
    backgroundColor: "#4d5b51",
  },
  roleBadgeText: {
    color: "#fffaf2",
    fontSize: 12,
    fontWeight: "700",
  },
  headerTagline: {
    color: "#d8c7a1",
    fontSize: 14,
    marginBottom: 6,
  },
});
