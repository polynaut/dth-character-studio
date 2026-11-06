import { Tabs, TabsContent, TabsList, TabsTrigger } from '../index.ts'

const body = { color: 'var(--muted-foreground)', fontSize: 13, padding: 8 } as const

export function Default() {
  return (
    <div style={{ padding: 16, maxWidth: 520 }}>
      <Tabs defaultValue="scan">
        <TabsList>
          <TabsTrigger value="scan">Scan &amp; index</TabsTrigger>
          <TabsTrigger value="install">Daz Studio &amp; Houdini</TabsTrigger>
          <TabsTrigger value="refresh">Refresh assets</TabsTrigger>
        </TabsList>
        <TabsContent value="scan"><div style={body}>Scenes to scan: KiraDefault_G9_GP.duf</div></TabsContent>
        <TabsContent value="install"><div style={body}>Houdini 22.0.368</div></TabsContent>
        <TabsContent value="refresh"><div style={body}>3 character definitions are stale.</div></TabsContent>
      </Tabs>
    </div>
  )
}

export function WithDisabled() {
  return (
    <div style={{ padding: 16, maxWidth: 520 }}>
      <Tabs defaultValue="character">
        <TabsList>
          <TabsTrigger value="character">Character</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="assets" disabled>Attachments</TabsTrigger>
        </TabsList>
        <TabsContent value="character"><div style={body}>Kira, Genesis 9, female.</div></TabsContent>
        <TabsContent value="products"><div style={body}>No scan yet.</div></TabsContent>
      </Tabs>
    </div>
  )
}
