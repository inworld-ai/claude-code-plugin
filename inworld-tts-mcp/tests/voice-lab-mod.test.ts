import { expect, test } from 'claude-code/testing'

const OUTPUT = [
  {
    type: 'text',
    text:
      'Rendered "Welcome back!" in 2 voices with inworld-tts-2. Play buttons for each clip are shown.\n' +
      'A: Ashley → /tmp/inworld-voice-lab/x/voice-A-Ashley.mp3\n' +
      'B: Dennis → /tmp/inworld-voice-lab/x/voice-B-Dennis.mp3\n' +
      'Ask which one they prefer.',
  },
]

const site = (tool: string, surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'inworld',
    component: 'ToolResult',
    requestId: 'toolu_1',
    surface,
    viewport: { columns: 100, rows: 30 },
    props: { tool_use_id: 'toolu_1', tool, output: OUTPUT, isErrored: false },
  }) as const

test('compare_voices results get play and use buttons on both surfaces', async ($, on) => {
  const played: string[] = []
  const submitted: string[] = []
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('fs.read', ($, e) => ({ value: { base64: btoa(e.path) } }))
  on('audio.play', ($, e) => {
    played.push(atob(e.clip.base64))
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(site('mcp__plugin_inworld_voice-lab__compare_voices', surface))
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    expect(await ui.find({ key: 'play-A' })).toBeDefined()
    expect(await ui.find({ key: 'play-B' })).toBeDefined()
    await ui.press({ key: 'play-B' })
    await ui.press({ key: 'use-B' })
    await ui.unmount()
  }

  expect(played).toEqual([
    '/tmp/inworld-voice-lab/x/voice-B-Dennis.mp3',
    '/tmp/inworld-voice-lab/x/voice-B-Dennis.mp3',
  ])
  expect(submitted).toEqual([
    'Use voice B (Dennis) for this project.',
    'Use voice B (Dennis) for this project.',
  ])
})

test('other tools are left as Claude Code draws them', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  const ui = await $.ui.mount(site('Bash', 'terminal'))
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(await ui.find({ key: 'play-A' })).toBeUndefined()
})

test('design and text-check results get buttons with their own Use message', async ($, on) => {
  const submitted: string[] = []
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const mount = (tool: string, text: string) =>
    $.ui.mount({ ...site(tool, 'terminal'), props: { ...site(tool, 'terminal').props, output: [{ type: 'text', text }] } })

  const design = await mount(
    'mcp__plugin_inworld_voice-lab__design_voice',
    'Designed 2 preview voices.\nA: ws__design-voice-1a → /tmp/x/voice-A-ws__design-voice-1a.mp3\nB: ws__design-voice-2b → /tmp/x/voice-B-ws__design-voice-2b.mp3',
  )
  expect(await design.find({ type: 'Text', text: 'Designed voices' })).toBeDefined()
  await design.press({ key: 'use-B' })
  await design.unmount()

  const check = await mount(
    'mcp__plugin_inworld_voice-lab__check_speech_text',
    'Fixed text.\nA: original → /tmp/x/voice-A-original-Ashley.mp3\nB: fixed → /tmp/x/voice-B-fixed-Ashley.mp3',
  )
  expect(await check.find({ key: 'play-A' })).toBeDefined()
  await check.press({ key: 'use-B' })

  expect(submitted).toEqual([
    'Save voice B (ws__design-voice-2b) and use it for this project.',
    'Go with the fixed version (B) of the text.',
  ])
})
