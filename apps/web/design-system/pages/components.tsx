import { demoFile, demoUrl, humanize, s, Frame, Title, type Manifest } from '../lib/ui.tsx'

export function ComponentPage({ file, m }: { file: string; m: Manifest }) {
  const demos = m.demos.filter((d) => demoFile(d.module) === file)
  if (demos.length === 0) return <Title>No demo named {file}</Title>
  return (
    <>
      <Title lead={`${demos.length} demo${demos.length === 1 ? '' : 's'}, each rendered in its own frame from ${demos[0].module.replace(/^(\.\.\/)+/, '')}.`}>
        {humanize(file)}
      </Title>
      {demos.map((d) => (
        <section key={d.export}>
          <h2 style={{ ...s.h2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            {humanize(d.export)}
            <a style={s.link} href={demoUrl(d)} target="_blank" rel="noreferrer">Open</a>
          </h2>
          <Frame src={demoUrl(d)} title={`${file} ${d.export}`} height={d.height} />
        </section>
      ))}
    </>
  )
}
