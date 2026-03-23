function GuardianStudentSwitcher({
  linkedStudents,
  activeStudentId,
  onChange,
  loading = false,
  label = 'Estudiante activo',
  helper = 'El estudiante seleccionado se comparte entre las vistas del portal.',
}) {
  return (
    <div className="students-toolbar guardian-student-switcher">
      <div className="guardian-student-switcher-copy">
        <h3>{label}</h3>
        <p>{helper}</p>
      </div>
      <label className="guardian-student-switcher-control">
        <span>Seleccionar estudiante</span>
        <select
          className="guardian-student-switcher-select"
          value={activeStudentId}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading || linkedStudents.length === 0}
        >
          {linkedStudents.length === 0 ? (
            <option value="">Sin estudiantes vinculados</option>
          ) : (
            linkedStudents.map((student) => (
              <option key={student.studentUid} value={student.studentUid}>
                {student.studentName || 'Estudiante'}{student.studentGrade ? ` · ${student.studentGrade}` : ''}{student.studentGroup ? `-${student.studentGroup}` : ''}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  )
}

export default GuardianStudentSwitcher
