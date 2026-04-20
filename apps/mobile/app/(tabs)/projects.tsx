import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { AppScreen, Card, EmptyState, Field, Hero, LoadingState, Message, PrimaryButton, SecondaryButton } from "../../src/components/ui";
import { createJob, listJobsWithStats, type JobWithStats } from "../../src/lib/jobs";

function formatProjectAddress(job: Pick<JobWithStats, "address_label" | "address1" | "address2" | "city" | "state" | "postal">) {
  if (job.address_label) {
    return job.address_label;
  }

  return [job.address1, job.address2, job.city, job.state, job.postal].filter(Boolean).join(", ") || null;
}

export default function ProjectsTab() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [notes, setNotes] = useState("");

  async function loadJobs() {
    const nextJobs = await listJobsWithStats();
    setJobs(nextJobs);
  }

  useEffect(() => {
    loadJobs()
      .catch((error) => {
        console.error("Failed to load projects.", error);
        setMessage(error instanceof Error ? error.message : "Failed to load projects.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCreateProject() {
    if (!name.trim()) {
      setMessage("Project name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await createJob({ name, address1, address2, city, state, postal, notes });
      await loadJobs();
      setName("");
      setAddress1("");
      setAddress2("");
      setCity("");
      setState("");
      setPostal("");
      setNotes("");
      setShowCreate(false);
      setMessage("Project created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen>
      <Hero
        eyebrow="Projects"
        title="See active staging work."
        subtitle="This tab is wired to the `jobs` table and gives you a simple project rollup."
      />
      <SecondaryButton label={showCreate ? "Hide Create Project" : "Create Project"} onPress={() => setShowCreate((current) => !current)} />
      {message ? <Message text={message} tone={message === "Project created." ? "success" : "error"} /> : null}
      {showCreate ? (
        <Card>
          <Field label="Client / Project Name" onChangeText={setName} value={name} />
          <Field label="Street Address" onChangeText={setAddress1} value={address1} />
          <Field label="Address Line 2" onChangeText={setAddress2} value={address2} />
          <Field label="City" onChangeText={setCity} value={city} />
          <Field label="State" onChangeText={setState} value={state} />
          <Field label="Postal Code" onChangeText={setPostal} value={postal} />
          <Field label="Notes" multiline onChangeText={setNotes} value={notes} />
          <PrimaryButton disabled={saving} label={saving ? "Creating..." : "Save Project"} onPress={() => void handleCreateProject()} />
        </Card>
      ) : null}
      {loading ? <LoadingState label="Loading projects..." /> : null}
      {!loading && jobs.length === 0 ? <EmptyState body="Create a new project here, then open it to build the pack list." title="No projects yet." /> : null}
      {!loading
        ? jobs.map((job) => (
            <Pressable key={job.id} onPress={() => router.push(`/projects/${job.id}`)}>
              <Card>
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#1f2b26" }}>{job.name}</Text>
                <Text style={{ color: "#49564f" }}>{formatProjectAddress(job) ?? "No address yet"}</Text>
                <Text style={{ color: "#49564f" }}>{job.latitude != null && job.longitude != null ? "Map pin ready" : "Missing map coordinates"}</Text>
                <Text style={{ color: "#49564f" }}>Status: {job.status}</Text>
                <Text style={{ color: "#49564f" }}>Applied scenes: {job.sceneApplicationCount}</Text>
                <Text style={{ color: "#49564f" }}>Pack requests: {job.packRequestCount}</Text>
                <Text style={{ color: "#49564f" }}>Currently assigned: {job.activeItemCount}</Text>
                <Text style={{ color: "#49564f" }}>Imported from this house: {job.importedItemCount}</Text>
              </Card>
            </Pressable>
          ))
        : null}
    </AppScreen>
  );
}
