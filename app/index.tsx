import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Task = {
  id: string;
  created_by: string;
  title: string;
  created_at: string;
  group_id: string | null;
  assigned_to: string | null;
  status: "open" | "in_progress" | "done";
};

type Group = {
  id: string;
  name: string;
};

type ProfileRow = {
  id: string;
  email: string;
};

type MessageType = "error" | "success" | "";

export default function HomeScreen() {
  const [session, setSession] = useState<any>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});

  const [newTask, setNewTask] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [taskTarget, setTaskTarget] = useState<"personal" | "group">(
    "personal",
  );

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [loading, setLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [menuOpen, setMenuOpen] = useState(false);

  const [authMessage, setAuthMessage] = useState("");
  const [authMessageType, setAuthMessageType] = useState<MessageType>("");
  const [taskMessage, setTaskMessage] = useState("");
  const [taskMessageType, setTaskMessageType] = useState<MessageType>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function initUserData() {
      if (session?.user) {
        await ensureProfile(session.user);
        await fetchGroups();
      } else {
        setTasks([]);
        setGroups([]);
        setProfilesMap({});
        setActiveGroupId(null);
      }
    }

    initUserData();
  }, [session]);

  useEffect(() => {
    if (session?.user) {
      fetchTasks();
    } else {
      setTasks([]);
      setProfilesMap({});
    }
  }, [session, activeGroupId]);

  async function ensureProfile(user: { id: string; email?: string | null }) {
    if (!user.email) return;

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email.trim().toLowerCase(),
    });
  }

  async function fetchGroups() {
    if (!session?.user) return;

    const userId = session.user.id;

    const { data: ownedGroups, error: ownedError } = await supabase
      .from("groups")
      .select("id, name, owner_id")
      .eq("owner_id", userId);

    if (ownedError) {
      setTaskMessageType("error");
      setTaskMessage(`Ryhmien haku epäonnistui: ${ownedError.message}`);
      return;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId);

    if (membershipError) {
      setTaskMessageType("error");
      setTaskMessage(
        `Ryhmien jäsenyyksien haku epäonnistui: ${membershipError.message}`,
      );
      return;
    }

    const membershipIds = (memberships ?? []).map((m) => m.group_id);

    let memberGroups: Group[] = [];
    if (membershipIds.length > 0) {
      const { data: fetchedMemberGroups, error: memberGroupsError } =
        await supabase
          .from("groups")
          .select("id, name, owner_id")
          .in("id", membershipIds);

      if (memberGroupsError) {
        setTaskMessageType("error");
        setTaskMessage(
          `Jäsenryhmien haku epäonnistui: ${memberGroupsError.message}`,
        );
        return;
      }

      memberGroups = (fetchedMemberGroups ?? []) as Group[];
    }

    const merged = new Map<string, Group>();
    [...((ownedGroups ?? []) as Group[]), ...memberGroups].forEach((group) => {
      merged.set(group.id, group);
    });

    const finalGroups = Array.from(merged.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    setGroups(finalGroups);

    if (!activeGroupId && finalGroups.length > 0) {
      setActiveGroupId(finalGroups[0].id);
    }

    if (
      activeGroupId &&
      finalGroups.length > 0 &&
      !finalGroups.some((group) => group.id === activeGroupId)
    ) {
      setActiveGroupId(finalGroups[0].id);
    }
  }

  async function fetchTasks() {
    if (!session?.user) return;

    setTasksLoading(true);

    const personalPromise = supabase
      .from("tasks")
      .select("*")
      .is("group_id", null)
      .eq("created_by", session.user.id);

    const groupPromise = activeGroupId
      ? supabase.from("tasks").select("*").eq("group_id", activeGroupId)
      : Promise.resolve({ data: [], error: null });

    const [personalResult, groupResult] = await Promise.all([
      personalPromise,
      groupPromise,
    ]);

    if (personalResult.error) {
      setTasksLoading(false);
      setTaskMessageType("error");
      setTaskMessage(
        `Henkilökohtaisten tehtävien haku epäonnistui: ${personalResult.error.message}`,
      );
      return;
    }

    if (groupResult.error) {
      setTasksLoading(false);
      setTaskMessageType("error");
      setTaskMessage(
        `Ryhmän tehtävien haku epäonnistui: ${groupResult.error.message}`,
      );
      return;
    }

    const combined = [
      ...((personalResult.data ?? []) as Task[]),
      ...((groupResult.data ?? []) as Task[]),
    ];

    const uniqueMap = new Map<string, Task>();
    combined.forEach((task) => uniqueMap.set(task.id, task));

    const fetchedTasks = Array.from(uniqueMap.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    setTasks(fetchedTasks);

    const userIds = Array.from(
      new Set(
        fetchedTasks
          .flatMap((task) => [task.assigned_to, task.created_by])
          .filter(Boolean) as string[],
      ),
    );

    if (userIds.length === 0) {
      setProfilesMap({});
      setTasksLoading(false);
      return;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    if (!profilesError) {
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((profile: ProfileRow) => {
        map[profile.id] = profile.email;
      });
      setProfilesMap(map);
    }

    setTasksLoading(false);
  }

  async function handleAuth() {
    setAuthMessage("");
    setAuthMessageType("");

    if (!email.trim() || !password.trim()) {
      setAuthMessageType("error");
      setAuthMessage("Syötä sähköposti ja salasana.");
      return;
    }

    setLoading(true);

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        setAuthMessageType("error");
        setAuthMessage(error.message);
      } else {
        setAuthMessageType("success");
        setAuthMessage("Tili luotu. Voit nyt kirjautua sisään.");
        setAuthMode("login");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        const errorMessage = error.message.toLowerCase();

        if (
          errorMessage.includes("email not confirmed") ||
          errorMessage.includes("email not verified") ||
          errorMessage.includes("signup not confirmed")
        ) {
          setAuthMessageType("error");
          setAuthMessage(
            "Käyttäjän rekisteröintiä ei vahvistettu. Tarkista sähköposti ja vahvista tili ennen kirjautumista.",
          );
        } else if (errorMessage.includes("rate limit")) {
          setAuthMessageType("error");
          setAuthMessage(
            "Vahvistussähköposteja on pyydetty liian monta kertaa. Odota hetki ja kokeile uudelleen.",
          );
        } else {
          setAuthMessageType("error");
          setAuthMessage("Sähköposti tai salasana on väärin.");
        }
      }
    }

    setLoading(false);
  }

  async function addTask() {
    setTaskMessage("");
    setTaskMessageType("");

    if (!newTask.trim()) {
      setTaskMessageType("error");
      setTaskMessage("Tehtävän nimi ei voi olla tyhjä.");
      return;
    }

    if (!session?.user) return;

    if (taskTarget === "group" && !activeGroupId) {
      setTaskMessageType("error");
      setTaskMessage(
        "Valitse ensin ryhmä tai käytä henkilökohtaista tehtävää.",
      );
      return;
    }

    setLoading(true);

    const payload =
      taskTarget === "personal"
        ? {
            title: newTask.trim(),
            created_by: session.user.id,
            group_id: null,
            assigned_to: session.user.id,
            status: "in_progress" as const,
          }
        : {
            title: newTask.trim(),
            created_by: session.user.id,
            group_id: activeGroupId,
            assigned_to: null,
            status: "open" as const,
          };

    const { error } = await supabase.from("tasks").insert(payload);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(`Tehtävän lisääminen epäonnistui: ${error.message}`);
    } else {
      setNewTask("");
      setTaskMessageType("success");
      setTaskMessage(
        taskTarget === "personal"
          ? "Henkilökohtainen tehtävä lisätty."
          : "Ryhmätehtävä lisätty.",
      );
      await fetchTasks();
    }

    setLoading(false);
  }

  async function chooseTask(task: Task) {
    if (!session?.user) return;

    setLoading(true);
    setTaskMessage("");
    setTaskMessageType("");

    const { error } = await supabase
      .from("tasks")
      .update({
        assigned_to: session.user.id,
        status: "in_progress",
      })
      .eq("id", task.id);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(`Tehtävän valinta epäonnistui: ${error.message}`);
    } else {
      await fetchTasks();
    }

    setLoading(false);
  }

  async function releaseTask(task: Task) {
    setLoading(true);
    setTaskMessage("");
    setTaskMessageType("");

    const updatePayload =
      task.group_id === null
        ? {
            assigned_to: session.user.id,
            status: "in_progress" as const,
          }
        : {
            assigned_to: null,
            status: "open" as const,
          };

    const { error } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", task.id);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(`Tehtävän vapauttaminen epäonnistui: ${error.message}`);
    } else {
      await fetchTasks();
    }

    setLoading(false);
  }

  async function markTaskDone(task: Task) {
    setLoading(true);
    setTaskMessage("");
    setTaskMessageType("");

    const { error } = await supabase
      .from("tasks")
      .update({
        status: "done",
      })
      .eq("id", task.id);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(
        `Tehtävän merkitseminen valmiiksi epäonnistui: ${error.message}`,
      );
    } else {
      await fetchTasks();
    }

    setLoading(false);
  }

  async function markTaskOpen(task: Task) {
    setLoading(true);
    setTaskMessage("");
    setTaskMessageType("");

    const updatePayload =
      task.group_id === null
        ? {
            status: "in_progress" as const,
            assigned_to: task.created_by,
          }
        : {
            status: "open" as const,
            assigned_to: null,
          };

    const { error } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", task.id);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(
        `Tehtävän palauttaminen kesken epäonnistui: ${error.message}`,
      );
    } else {
      await fetchTasks();
    }

    setLoading(false);
  }

  async function deleteTask(id: string) {
    setLoading(true);
    setTaskMessage("");
    setTaskMessageType("");

    const { error } = await supabase.from("tasks").delete().eq("id", id);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(`Tehtävän poisto epäonnistui: ${error.message}`);
    } else {
      await fetchTasks();
    }

    setLoading(false);
  }

  async function saveEdit() {
    if (!editingTaskId) return;

    setTaskMessage("");
    setTaskMessageType("");

    if (!editingText.trim()) {
      setTaskMessageType("error");
      setTaskMessage("Muokattu tehtävä ei voi olla tyhjä.");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("tasks")
      .update({ title: editingText.trim() })
      .eq("id", editingTaskId);

    if (error) {
      setTaskMessageType("error");
      setTaskMessage(`Tehtävän muokkaus epäonnistui: ${error.message}`);
    } else {
      setEditingTaskId(null);
      setEditingText("");
      await fetchTasks();
    }

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function getAssignedEmail(userId: string | null) {
    if (!userId) return null;
    return profilesMap[userId] ?? "Tuntematon käyttäjä";
  }

  function getScopeLabel(task: Task) {
    if (!task.group_id) return "Henkilökohtainen";
    const group = groups.find((g) => g.id === task.group_id);
    return group ? `Ryhmä: ${group.name}` : "Ryhmä";
  }

  function renderTaskItem(item: Task, section: "my" | "group" | "done") {
    const assignedEmail = getAssignedEmail(item.assigned_to);

    return (
      <View style={styles.taskCard}>
        {editingTaskId === item.id ? (
          <>
            <TextInput
              style={styles.input}
              value={editingText}
              onChangeText={setEditingText}
            />

            <View style={styles.row}>
              <Pressable
                style={[styles.smallButton, loading && styles.disabledButton]}
                onPress={saveEdit}
                disabled={loading}
              >
                <Text style={styles.smallButtonText}>Tallenna</Text>
              </Pressable>

              <Pressable
                style={styles.smallButtonMuted}
                onPress={() => {
                  setEditingTaskId(null);
                  setEditingText("");
                }}
              >
                <Text style={styles.smallButtonText}>Peruuta</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusBadge,
                  item.status === "open"
                    ? styles.statusOpen
                    : item.status === "in_progress"
                      ? styles.statusInProgress
                      : styles.statusDone,
                ]}
              >
                <Text style={styles.statusText}>
                  {item.status === "open"
                    ? "Avoin"
                    : item.status === "in_progress"
                      ? "Työn alla"
                      : "Valmis"}
                </Text>
              </View>
            </View>

            <Text style={styles.taskTitle}>{item.title}</Text>
            <Text style={styles.taskMeta}>{getScopeLabel(item)}</Text>

            {section === "group" &&
            item.status === "in_progress" &&
            assignedEmail ? (
              <Text style={styles.taskMeta}>Työn alla: {assignedEmail}</Text>
            ) : null}

            {section === "my" && item.group_id !== null && assignedEmail ? (
              <Text style={styles.taskMeta}>Tekijä: {assignedEmail}</Text>
            ) : null}

            <View style={styles.row}>
              {section === "group" && item.status === "open" ? (
                <Pressable
                  style={[styles.smallButton, loading && styles.disabledButton]}
                  onPress={() => chooseTask(item)}
                  disabled={loading}
                >
                  <Text style={styles.smallButtonText}>Valitse tehtävä</Text>
                </Pressable>
              ) : null}

              {section === "my" ? (
                <>
                  <Pressable
                    style={[
                      styles.smallButton,
                      loading && styles.disabledButton,
                    ]}
                    onPress={() => markTaskDone(item)}
                    disabled={loading}
                  >
                    <Text style={styles.smallButtonText}>
                      Merkitse valmiiksi
                    </Text>
                  </Pressable>

                  {item.group_id !== null ? (
                    <Pressable
                      style={[
                        styles.smallButtonMuted,
                        loading && styles.disabledButton,
                      ]}
                      onPress={() => releaseTask(item)}
                      disabled={loading}
                    >
                      <Text style={styles.smallButtonText}>
                        Palauta ryhmälle
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}

              {section === "done" ? (
                <Pressable
                  style={[
                    styles.smallButtonMuted,
                    loading && styles.disabledButton,
                  ]}
                  onPress={() => markTaskOpen(item)}
                  disabled={loading}
                >
                  <Text style={styles.smallButtonText}>Palauta kesken</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[
                  styles.smallButtonMuted,
                  loading && styles.disabledButton,
                ]}
                onPress={() => {
                  setEditingTaskId(item.id);
                  setEditingText(item.title);
                }}
                disabled={loading}
              >
                <Text style={styles.smallButtonText}>Muokkaa</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.smallButtonDanger,
                  loading && styles.disabledButton,
                ]}
                onPress={() => deleteTask(item.id)}
                disabled={loading}
              >
                <Text style={styles.smallButtonText}>Poista</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.authWrapper}>
          <View style={styles.authCard}>
            <Text style={styles.title}>JahtiLista</Text>
            <Text style={styles.subtitle}>
              Metsästysseuran tehtävät ja jahtipäivän valmistelut yhdessä
              paikassa
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Sähköposti"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <TextInput
              style={styles.input}
              placeholder="Salasana"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {authMessage ? (
              <Text
                style={[
                  styles.messageText,
                  authMessageType === "error"
                    ? styles.errorText
                    : styles.successText,
                ]}
              >
                {authMessage}
              </Text>
            ) : null}

            <Pressable
              style={styles.primaryButton}
              onPress={handleAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {authMode === "login" ? "Kirjaudu sisään" : "Luo tili"}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() =>
                setAuthMode(authMode === "login" ? "signup" : "login")
              }
            >
              <Text style={styles.linkText}>
                {authMode === "login"
                  ? "Eikö tiliä vielä ole? Luo tili"
                  : "Onko sinulla jo tili? Kirjaudu sisään"}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const myTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      (task.group_id === null || task.assigned_to === session.user.id),
  );

  const groupTasks = tasks.filter(
    (task) =>
      task.group_id !== null &&
      task.status !== "done" &&
      task.assigned_to !== session.user.id,
  );

  const completedTasks = tasks.filter((task) => task.status === "done");

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
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>JahtiLista</Text>
              <Text style={styles.headerTagline}>
                Metsästysseuran tehtävät yhdessä paikassa
              </Text>
              <Text style={styles.subtitleSmall}>{session.user.email}</Text>
            </View>

            <View style={styles.menuWrapper}>
              <Pressable
                onPress={() => setMenuOpen((prev) => !prev)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>☰</Text>
              </Pressable>

              {menuOpen && (
                <View style={styles.dropdownMenu}>
                  <Pressable
                    style={styles.dropdownItem}
                    onPress={() => {
                      setMenuOpen(false);
                      router.push("/groups");
                    }}
                  >
                    <Text style={styles.dropdownItemText}>Ryhmät</Text>
                  </Pressable>

                  <Pressable
                    style={styles.dropdownItem}
                    onPress={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                  >
                    <Text style={styles.dropdownItemText}>Kirjaudu ulos</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>

          <View style={styles.addCard}>
            <Text style={styles.sectionTitle}>Aktiivinen ryhmä</Text>

            {groups.length === 0 ? (
              <Text style={styles.emptyText}>
                Sinulla ei ole vielä ryhmiä. Luo tai liity ryhmään valikosta.
              </Text>
            ) : (
              <View style={styles.row}>
                {groups.map((group) => (
                  <Pressable
                    key={group.id}
                    onPress={() => setActiveGroupId(group.id)}
                    style={[
                      styles.groupChip,
                      activeGroupId === group.id
                        ? styles.groupChipActive
                        : undefined,
                    ]}
                  >
                    <Text style={styles.smallButtonText}>{group.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.addCard}>
            <Text style={styles.sectionTitle}>Lisää tehtävä</Text>

            <View style={styles.row}>
              <Pressable
                onPress={() => setTaskTarget("personal")}
                style={[
                  styles.targetChip,
                  taskTarget === "personal"
                    ? styles.targetChipActive
                    : undefined,
                ]}
              >
                <Text style={styles.smallButtonText}>Henkilökohtainen</Text>
              </Pressable>

              <Pressable
                onPress={() => setTaskTarget("group")}
                style={[
                  styles.targetChip,
                  taskTarget === "group" ? styles.targetChipActive : undefined,
                ]}
              >
                <Text style={styles.smallButtonText}>Aktiivinen ryhmä</Text>
              </Pressable>
            </View>

            <Text style={styles.taskMeta}>
              {taskTarget === "personal"
                ? "Tehtävä lisätään omiin henkilökohtaisiin tehtäviin."
                : activeGroupId
                  ? "Tehtävä lisätään valittuun ryhmään."
                  : "Valitse ensin ryhmä, jos haluat lisätä ryhmätehtävän."}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Esim. Tarkista torni 2"
              placeholderTextColor="#94a3b8"
              value={newTask}
              onChangeText={setNewTask}
            />

            {taskMessage ? (
              <Text
                style={[
                  styles.messageText,
                  taskMessageType === "error"
                    ? styles.errorText
                    : styles.successText,
                ]}
              >
                {taskMessage}
              </Text>
            ) : null}

            <Pressable
              style={styles.primaryButton}
              onPress={addTask}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Lisää tehtävä</Text>
              )}
            </Pressable>
          </View>

          {tasksLoading ? (
            <ActivityIndicator size="large" color="#d97706" />
          ) : tasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Ei tehtäviä vielä</Text>
              <Text style={styles.emptyText}>
                Lisää ensimmäinen henkilökohtainen tehtävä tai ryhmätehtävä.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Omat tehtävät</Text>
              {myTasks.length === 0 ? (
                <View style={styles.emptyStateSmall}>
                  <Text style={styles.emptyText}>Ei omia tehtäviä.</Text>
                </View>
              ) : (
                myTasks.map((item) => (
                  <View key={item.id}>{renderTaskItem(item, "my")}</View>
                ))
              )}

              <Text style={styles.sectionTitle}>Ryhmän tehtävät</Text>
              {groupTasks.length === 0 ? (
                <View style={styles.emptyStateSmall}>
                  <Text style={styles.emptyText}>Ei ryhmän tehtäviä.</Text>
                </View>
              ) : (
                groupTasks.map((item) => (
                  <View key={item.id}>{renderTaskItem(item, "group")}</View>
                ))
              )}

              <Text style={styles.sectionTitle}>Valmiit tehtävät</Text>
              {completedTasks.length === 0 ? (
                <View style={styles.emptyStateSmall}>
                  <Text style={styles.emptyText}>
                    Ei valmiita tehtäviä vielä.
                  </Text>
                </View>
              ) : (
                completedTasks.map((item) => (
                  <View key={item.id}>{renderTaskItem(item, "done")}</View>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101712",
  },
  authWrapper: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  authCard: {
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    backgroundColor: "#1b241d",
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  header: {
    marginTop: 8,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    zIndex: 10,
  },
  headerTextWrap: {
    flex: 1,
  },
  menuWrapper: {
    position: "relative",
  },
  dropdownMenu: {
    position: "absolute",
    top: 52,
    right: 0,
    minWidth: 180,
    backgroundColor: "#1b241d",
    borderRadius: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#324136",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemText: {
    color: "#f4f1e8",
    fontWeight: "600",
  },
  addCard: {
    backgroundColor: "#1b241d",
    padding: 18,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  title: {
    color: "#f4f1e8",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    color: "#c8d0c8",
    fontSize: 15,
    marginBottom: 20,
    lineHeight: 22,
  },
  subtitleSmall: {
    color: "#c8d0c8",
    fontSize: 14,
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
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#445146",
  },
  secondaryButtonText: {
    color: "#f4f1e8",
    fontWeight: "600",
  },
  linkText: {
    color: "#d8a15f",
    marginTop: 14,
    textAlign: "center",
  },
  taskCard: {
    backgroundColor: "#1b241d",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  taskTitle: {
    color: "#f4f1e8",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 12,
  },
  taskMeta: {
    color: "#c8d0c8",
    fontSize: 13,
    marginBottom: 12,
    marginTop: 12,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  smallButton: {
    backgroundColor: "#3f6a45",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallButtonMuted: {
    backgroundColor: "#4d5b51",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallButtonDanger: {
    backgroundColor: "#8b2f2f",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallButtonText: {
    color: "#fffaf2",
    fontWeight: "600",
  },
  emptyState: {
    backgroundColor: "#1b241d",
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  emptyStateSmall: {
    backgroundColor: "#1b241d",
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2f3a31",
  },
  emptyTitle: {
    color: "#f4f1e8",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyText: {
    color: "#c8d0c8",
    lineHeight: 22,
  },
  groupChip: {
    backgroundColor: "#4d5b51",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  groupChipActive: {
    backgroundColor: "#a35f1c",
  },
  targetChip: {
    backgroundColor: "#4d5b51",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  targetChipActive: {
    backgroundColor: "#355c3e",
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
  scrollContent: {
    paddingBottom: 80,
  },
  contentInner: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  statusRow: {
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusOpen: {
    backgroundColor: "#4d5b51",
  },
  statusInProgress: {
    backgroundColor: "#a07822",
  },
  statusDone: {
    backgroundColor: "#3f6a45",
  },
  statusText: {
    color: "#fffaf2",
    fontSize: 12,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.55,
  },
  headerTagline: {
    color: "#d8c7a1",
    fontSize: 14,
    marginBottom: 6,
  },
});
