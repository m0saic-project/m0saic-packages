commands i used

PS C:\src\m0saic> node packages/template-utils/tools/render-template.mjs "@m0saic/hero/bar-graph/internal/chart-frame/v1" packages/template-utils/tools/dev/props/chart-frame.props.json .scratch/chart-frame.mosaic --wrap --inject=packages/template-utils/tools/dev/inject/chart-frame.inject.json

that generates a .mosaic file that I could then render directly to video

m0saic make .scratch/repro-nested-mosaic-overlay-leaf.mosaic -w 1920 -h 1080

node packages/template-utils/tools/dev/render-pack.mjs packages/template-utils/tools/dev/packs/chart-frame.pack.json