# file locations

MAIN_SRC=src/index.ts

# phony stuff

all: compile

init: node_modules

# actual work

node_modules: package.json
	npm install
	touch node_modules

clean:
	rm -r dist

test: init
	npm test

compile: node_modules Makefile
	@mkdir -p dist
	node_modules/.bin/tsc --declaration --outDir dist/js/
	node_modules/.bin/babel --out-dir dist/ejs/ dist/js
	node_modules/.bin/babel --plugins "@babel/plugin-transform-modules-commonjs" --out-dir dist/cjs/ dist/ejs

pack: compile
	npm pack

publish: dist
	npm publish

.PHONY: all compile pack min clean doc test karma init example
