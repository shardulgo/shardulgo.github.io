'use strict';

var gulp = require('gulp'),
	plugins = {
		angularTemplatecache: require('gulp-angular-templatecache'),
		//debug: require('gulp-debug'),
		concat: require('gulp-concat'),
		domSrc: require('gulp-dom-src'),
		flatten: require('gulp-flatten'),
		inject: require('gulp-inject'),
		minifyHtml: require('gulp-htmlmin'),
		purifyCss: require('gulp-purifycss'),
		ngAnnotate: require('gulp-ng-annotate'),
		uglify: require('gulp-uglify'),
		rev: require('gulp-rev'),
		revReplace: require('gulp-rev-replace'),
		size: require('gulp-size')
	},
	_ = require('lodash'),
	fs = require('fs'),
	globby = require('globby'),
	mainBowerFiles = require('main-bower-files');

var clean = require('./clean').clean,
	inject = require('./inject'),
	injectDev = inject.injectDev,
	injectToDist = inject.injectToDist,

	scripts = require('./scripts'),
	transpile = scripts.transpile,
	transpileWithSourcemaps = scripts.transpileWithSourcemaps,

	config = require('./config'),
	paths = config.paths,
	files = config.files,
	fileCollections = config.fileCollections;


var buildDev = gulp.series(
	clean,
	gulp.parallel(
		injectDev,
		moveAndFlattenFonts,
		transpileWithSourcemaps

	)
);

//TODO: combine some more tasks and check if this improves performance.
var buildDist = gulp.series(

	clean,
	gulp.parallel(

		injectDev,
		moveAndFlattenFonts,
		transpile
	),

	//move all the things
	gulp.parallel(
		moveHtml,
		moveIndexHtml,
		move404Html,
		moveBowerComponentImagesToDist,
		moveImagesToDist,
		moveFontsToDist,
		moveIconsToDist,
		moveJsonToDist,
		moveServerConfigFiles,
		moveScriptsToDist,
		moveCssToDist,
		moveAndTemplatifyHtml
	),
	replaceRevisionedPaths,
	injectToDist
);



//TODO: speed it up by checking if the files are already there.
function moveAndFlattenFonts() {
	//Suggestion: user gulp-expect-file to make sure a bower.json exists
	return gulp.src(files.bowerComponents + '.{eot,svg,ttf,woff,woff2}', {base: files.bowerComponents})
		.pipe(plugins.flatten())
		.pipe(gulp.dest(paths.tmpFonts));
}

// templatify and move html files ending in .template.html
function moveAndTemplatifyHtml() {
	//all html files the developer opts-in to templatecache
	return gulp.src(fileCollections.htmlTemplatecache)
		.pipe(plugins.minifyHtml(config.minifyHtml))
		.pipe(plugins.angularTemplatecache('template.js', {
			module: config.moduleName,
			standAlone: false
		}))
		.pipe(plugins.rev())
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

// move all html with a few exceptions
function moveHtml() {
	return gulp.src(fileCollections.htmlRevable)
		.pipe(plugins.minifyHtml(config.minifyHtml))
		.pipe(plugins.rev())
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.rev.manifest({
			merge: true
		}))
		.pipe(gulp.dest(paths.dist));
}

// index.html is moved separately because it cannot be minified before injection (it gets minified later in injectToDist)
function moveIndexHtml() {
	return gulp.src(files.indexHtml)
		//TODO: move to gulp-htmlmin so we can ignore the inject comments and stop doing the BAD thing below
		//BAD: keep comments so we can continue injecting to the dist index.html file
		.pipe(plugins.minifyHtml({
    		removeComments: false,
			collapseWhitespace: true,
			collapseBooleanAttributes: true,
			removeEmptyAttributes: true,
			removeScriptTypeAttributes: false,
			removeStyleLinkTypeAttributes: false

		}))
		.pipe(gulp.dest(paths.dist));
}

// 404.html is moved separately because it cannot be revved
function move404Html() {
	return gulp.src(files.html404)
		.pipe(plugins.minifyHtml(config.minifyHtml))
		.pipe(gulp.dest(paths.dist));
}

function moveFontsToDist() {
	return gulp.src(files.tmpFonts)
		.pipe(gulp.dest(paths.distFonts))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function moveBowerComponentImagesToDist() {
	return gulp.src(files.bowerComponents + '.{png,jpg,jpeg}', {base: paths.app})
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

//TODO: remove un-used images. Check if they are already there and don't bother moving if so.
function moveImagesToDist() {
	return gulp.src(files.images)
		.pipe(gulp.dest(paths.distImages))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function moveIconsToDist() {
	return gulp.src(files.favicons)
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function moveJsonToDist() {
	return gulp.src(fileCollections.json)
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function moveServerConfigFiles() {
	var filesToCopy = [];
	for (var i = 0; i < files.serverConfig.length; i++) {
		try {
			fs.lstatSync(files.serverConfig[i]);
			filesToCopy.push(files.serverConfig[i]);
		} catch (e) {
		}
	}
	return gulp.src(filesToCopy)
		.pipe(gulp.dest(paths.dist));
}

function moveScriptsToDist() {
	return plugins.domSrc({
		file: files.indexHtml,
		selector: 'script',
		attribute: 'src'
	})
		.pipe(plugins.ngAnnotate())
		.pipe(plugins.uglify()) //takes a long time
		.pipe(plugins.concat('app.js'))
		.pipe(plugins.rev())
		.pipe(gulp.dest(paths.dist))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function moveCssToDist() {
	return plugins.domSrc({
		file: files.indexHtml,
		selector: 'link',
		attribute: 'href'
	})
		.pipe(plugins.purifyCss(determinePurifyFiles('bootstrap.js'), {minify: true}))
		.pipe(plugins.rev())
		.pipe(gulp.dest(paths.distStyles))
		.pipe(plugins.size({title: 'SIZE: ', showFiles: true}));
}

function replaceRevisionedPaths() {
	return gulp.src(fileCollections.revReplaceFiles)
		.pipe(plugins.revReplace({manifest: gulp.src(files.distManifest)}))
		.pipe(gulp.dest(paths.dist));
}

// all the files that purify-css needs to check for dynamic classes (e.g. ng-class)
function determinePurifyFiles(excludes) {
	if (typeof excludes === 'string') {
		excludes = [excludes];
	}
	else if (!Array.isArray(excludes)) {
		excludes = [];
	}
	// this is _.endsWith, but it takes an array of strings
	function endsWith(str, targets) {
		var endsWithAny = false;
		targets.forEach(function (target) {
			if (_.endsWith(str, target)) {
				endsWithAny = true;
				return false; //exit iteration early once the first one is found
			}
		});
		return endsWithAny;
	}

	// dependency files that purify-css needs to check
	var purifyDependencyFiles = [];
	mainBowerFiles().forEach(function (file) {
		// just html and js (in the form of angular templatecaches) files can contain ng-classes
		// ignore things in the exclude list
		if (endsWith(file, ['.html', '.js']) && !endsWith(file, excludes)) {
			// strip out current working directory from beginning of file path
			// see https://github.com/ck86/main-bower-files#youve-got-a-flat-folderfile-structure-after-pipegulpdestmydestpath
			purifyDependencyFiles.push(file.replace(process.cwd() + '/', ''));
		}
	});

	var purifyFiles = globby.sync([
		paths.app + '/**/*.{js,html}',
		'!' + paths.app + '/**/*.spec.js',
		'!' + files.bowerComponents,
		'!' + files.tmp
	].concat(purifyDependencyFiles));

	//console.log(purifyFiles);
	return purifyFiles;
}

function logPurifyFiles(done) {
	console.log(globby.sync(determinePurifyFiles('bootstrap.js')));
	done();
}


module.exports = {
	buildDev: buildDev,
	buildDist: buildDist,
	moveHtml: moveHtml,
	moveIndexHtml: moveIndexHtml,
	moveAndTemplatifyHtml: moveAndTemplatifyHtml,
	moveCssToDist: moveCssToDist,
	moveScriptsToDist: moveScriptsToDist,
	moveIconsToDist: moveIconsToDist,
	moveImagesToDist: moveImagesToDist,
	moveJsonToDist: moveJsonToDist,
	logPurifyFiles: logPurifyFiles,
};
