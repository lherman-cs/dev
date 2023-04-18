package walk

// import "io/fs"
// 
// // Supported matches:
// //   1. glob patterns
// //   2. relative vs any match
// 
// func WalkDir(fsys fs.FS, root string, fn fs.WalkDirFunc) error {
// 	info, err := fs.Stat(fsys, root)
// 	if err != nil {
// 		err = fn(root, nil, err)
// 	} else {
// 		entry := fs.FileInfoToDirEntry(info)
// 		err = walkDirWithPatterns(fsys, root, entry, fn, nil)
// 	}
// 
// 	if err == fs.SkipDir || err == fs.SkipAll {
// 		return nil
// 	}
// 	return err
// }
// 
// func walkDirWithPatterns(fsys fs.FS, root string, d fs.DirEntry, fn fs.WalkDirFunc, patterns []string) error {
// 	err := fn(root, d, nil)
// 	if err != nil || !d.IsDir() {
// 		if err == fs.SkipDir && d.IsDir() {
// 			// Successfully skipped directory.
// 			err = nil
// 		}
// 		return err
// 	}
// 
// 	entries, err := fs.ReadDir(fsys, root)
// 	if err != nil {
// 	}
// 
// 	return nil
// }
